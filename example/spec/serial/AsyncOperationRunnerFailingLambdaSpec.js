'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');
const { ecs, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { getClusterArn, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { findAsyncOperationTaskDefinitionForDeployment } = require('../helpers/ecsHelpers');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner executing a failing lambda function', () => {
  let asyncOperationId;
  let asyncOperationModel;
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let asyncOperation;
  let failFunctionName;
  let payloadKey;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      asyncOperationsTableName = `${config.stackName}-AsyncOperationsTable`;
      failFunctionName = `${config.stackName}-AsyncOperationFail`;

      asyncOperationModel = new AsyncOperation({
        stackName: config.stackName,
        systemBucket: config.bucket,
        tableName: asyncOperationsTableName,
      });

      // Find the ARN of the cluster
      cluster = await getClusterArn(config.stackName);

      // Find the ARN of the AsyncOperationTaskDefinition
      asyncOperationTaskDefinition = await findAsyncOperationTaskDefinitionForDeployment(config.stackName);

      asyncOperationId = uuidv4();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${asyncOperationId}.json`;
      await s3().putObject({
        Bucket: config.bucket,
        Key: payloadKey,
        Body: JSON.stringify([1, 2, 3]),
      }).promise();
      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        description: 'Some description',
        operationType: 'ES Index',
        status: 'RUNNING',
      });

      const runTaskResponse = await ecs().runTask({
        cluster,
        taskDefinition: asyncOperationTaskDefinition,
        launchType: 'EC2',
        overrides: {
          containerOverrides: [
            {
              name: 'AsyncOperation',
              environment: [
                { name: 'asyncOperationId', value: asyncOperationId },
                { name: 'asyncOperationsTable', value: asyncOperationsTableName },
                { name: 'lambdaName', value: failFunctionName },
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` },
              ],
            },
          ],
        },
      }).promise();

      const failures = get(runTaskResponse, 'failures', []);
      if (failures.length > 0) {
        throw new Error(`Failed to start tasks: ${JSON.stringify(failures)}`);
      }

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn],
        }
      ).promise();

      asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'TASK_FAILED',
        stackName: config.stackName,
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('updates the status field to "TASK_FAILED"', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('TASK_FAILED');
  });

  it('updates the output field in DynamoDB', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);

      expect(parsedOutput.message).toBe('triggered failure');
    }
  });

  afterAll(async () => await s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise());
});
