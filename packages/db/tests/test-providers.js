/* eslint-disable unicorn/no-null */
const test = require('ava');

const {
  translateApiProviderToPostgresProvider,
  nullifyUndefinedProviderValues,
  encryptValueWithKMS,
} = require('../dist/provider');

test.beforeEach(() => {
  process.env.provider_kms_key_id = 'fakeKeyId';
});

test('translateApiProviderToPostgresProvider translates a Cumulus Provider object to a Postgres Provider object', async (t) => {
  const fakeEncryptFunction = async () => 'fakeEncryptedString';
  const cumulusProviderObject = {
    id: 'testId',
    globalConnectionLimit: 1,
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 1234,
    username: 'fakeUsername',
    password: 'fakePassword',
    encrypted: true,
    createdAt: 1234,
    updatedAt: 5678,
    privateKey: 'fakeKey',
    cmKeyId: 'fakecmId',
    certificateUri: 'fakeUri',
  };

  const expected = {
    certificateUri: 'fakeUri',
    cmKeyId: 'fakecmId',
    created_at: 1234,
    globalConnectionLimit: 1,
    host: 'fakeHost',
    name: 'testId',
    password: 'fakeEncryptedString',
    port: 1234,
    privateKey: 'fakeKey',
    protocol: 'fakeProtocol',
    updated_at: 5678,
    username: 'fakeEncryptedString',
  };
  const result = await translateApiProviderToPostgresProvider(
    cumulusProviderObject,
    fakeEncryptFunction
  );
  t.deepEqual(result, expected);
});

test('nullifyUndefinedProviderValues sets undefined provider values to "null"', async (t) => {
  const cumulusProviderObject = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
  };

  const expected = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
    username: null,
    password: null,
    globalConnectionLimit: null,
    privateKey: null,
    cmKeyId: null,
    certificateUri: null,
  };

  const actual = nullifyUndefinedProviderValues(cumulusProviderObject);
  t.deepEqual(actual, expected);
});

test.serial('encryptValueWithKMS throws if provder_kms_key_id does not exist', async (t) => {
  await t.throwsAsync(() => encryptValueWithKMS('somevalue'));
});

test.serial('encryptValueWithKMS encrypts the key', async (t) => {
  const actual = await encryptValueWithKMS('somevalue', () => 'encrypted');
  t.is(actual, 'encrypted');
});
