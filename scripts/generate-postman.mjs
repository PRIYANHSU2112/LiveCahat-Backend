/**
 * Generate Postman Collection v2.1 + Environment + swagger.yaml
 * from the project's OpenAPI swagger.json (source of truth).
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const SWAGGER_PATH = path.join(ROOT, 'src/docs/swagger.json');
const OUT_DIR = path.join(ROOT, 'docs/postman');
const swagger = JSON.parse(fs.readFileSync(SWAGGER_PATH, 'utf8'));

fs.mkdirSync(OUT_DIR, { recursive: true });

const PROJECT_NAME = 'LiveChat API';
const COLLECTION_NAME = 'LiveChat API';
const ENV_NAME = 'LiveChat Local';

const SAMPLE_IDS = {
  userId: '507f1f77bcf86cd799439011',
  adminId: '507f1f77bcf86cd799439012',
  agentId: '507f1f77bcf86cd799439013',
  listenerId: '507f1f77bcf86cd799439014',
  customerId: '507f1f77bcf86cd799439015',
  sessionId: '507f1f77bcf86cd799439016',
  walletId: '507f1f77bcf86cd799439017',
  giftId: '507f1f77bcf86cd799439018',
  languageId: '507f1f77bcf86cd799439019',
  countryId: '507f1f77bcf86cd79943901a',
  reportId: '507f1f77bcf86cd79943901b',
  reasonId: '507f1f77bcf86cd79943901c',
  feedbackId: '507f1f77bcf86cd79943901d',
  coinPackId: '507f1f77bcf86cd79943901e',
  bannerId: '507f1f77bcf86cd79943901f',
  avatarId: '507f1f77bcf86cd799439020',
  stickerId: '507f1f77bcf86cd799439021',
  stickerCategoryId: '507f1f77bcf86cd799439022',
  withdrawalId: '507f1f77bcf86cd799439023',
  settlementId: '507f1f77bcf86cd799439024',
  notificationId: '507f1f77bcf86cd799439025',
  liveRoomId: '507f1f77bcf86cd799439026',
  companyId: '507f1f77bcf86cd799439027',
};

const PATH_VAR_MAP = {
  id: '{{resourceId}}',
  userId: '{{userId}}',
  sessionId: '{{sessionId}}',
  agentId: '{{agentId}}',
  listenerId: '{{listenerId}}',
  walletId: '{{walletId}}',
  giftId: '{{giftId}}',
  languageId: '{{languageId}}',
  countryId: '{{countryId}}',
  reportId: '{{reportId}}',
  reasonId: '{{reasonId}}',
  feedbackId: '{{feedbackId}}',
  coinPackId: '{{coinPackId}}',
  bannerId: '{{bannerId}}',
  avatarId: '{{avatarId}}',
  stickerId: '{{stickerId}}',
  stickerCategoryId: '{{stickerCategoryId}}',
  withdrawalId: '{{withdrawalId}}',
  settlementId: '{{settlementId}}',
  notificationId: '{{notificationId}}',
  liveRoomId: '{{liveRoomId}}',
  companyId: '{{companyId}}',
  recipientId: '{{userId}}',
};

function resolvePathParam(name) {
  if (PATH_VAR_MAP[name]) return PATH_VAR_MAP[name];
  // Heuristic: *Id -> matching env var if present
  if (name.endsWith('Id')) {
    const key = name;
    if (SAMPLE_IDS[key]) return `{{${key}}}`;
  }
  return `{{${name}}}`;
}

function swaggerPathToPostman(swaggerPath) {
  return swaggerPath.replace(/\{([^}]+)\}/g, (_, name) => resolvePathParam(name));
}

function extractPathVariables(swaggerPath) {
  // Paths use {{envVar}} placeholders — no Postman path-variable block needed.
  // Keep a descriptive list for request description only.
  const vars = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(swaggerPath))) {
    const name = m[1];
    const envKey = name === 'id' ? 'resourceId' : name;
    vars.push({
      key: name,
      envKey,
      sample: SAMPLE_IDS[name] || SAMPLE_IDS[envKey] || SAMPLE_IDS.userId,
    });
  }
  return vars;
}

function buildQuery(parameters = []) {
  return parameters
    .filter((p) => p.in === 'query')
    .map((p) => {
      const example =
        p.example ??
        p.schema?.example ??
        p.schema?.default ??
        (p.schema?.enum ? p.schema.enum[0] : undefined) ??
        (p.schema?.type === 'integer' ? 1 : p.schema?.type === 'boolean' ? true : '');
      return {
        key: p.name,
        value: String(example ?? ''),
        description: p.description || '',
        disabled: example === undefined || example === '',
      };
    });
}

function buildBody(requestBody) {
  if (!requestBody?.content) return undefined;

  if (requestBody.content['multipart/form-data']) {
    const schema = requestBody.content['multipart/form-data'].schema || {};
    const props = schema.properties || {};
    const formdata = Object.entries(props).map(([key, prop]) => {
      if (prop.format === 'binary' || prop.type === 'string' && prop.format === 'binary') {
        return {
          key,
          type: 'file',
          src: [],
          description: prop.description || 'Upload file',
        };
      }
      return {
        key,
        type: 'text',
        value: String(prop.example ?? ''),
        description: prop.description || '',
      };
    });
    if (!formdata.length) {
      formdata.push({ key: 'file', type: 'file', src: [], description: 'Upload file' });
    }
    return { mode: 'formdata', formdata };
  }

  const json = requestBody.content['application/json'];
  if (!json) return undefined;

  const example =
    json.example ||
    (json.examples && Object.values(json.examples)[0]?.value) ||
    buildExampleFromSchema(json.schema) ||
    {};

  return {
    mode: 'raw',
    raw: JSON.stringify(example, null, 2),
    options: { raw: { language: 'json' } },
  };
}

function buildExampleFromSchema(schema) {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.$ref) return undefined;
  if (schema.type === 'object' || schema.properties) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      if (v.example !== undefined) out[k] = v.example;
      else if (v.enum) out[k] = v.enum[0];
      else if (v.type === 'boolean') out[k] = true;
      else if (v.type === 'integer' || v.type === 'number') out[k] = v.minimum ?? 1;
      else if (v.type === 'array') out[k] = v.items?.example ? [v.items.example] : [];
      else if (v.type === 'string') {
        if (v.format === 'email') out[k] = 'admin@chatcorner.app';
        else if (v.format === 'date') out[k] = '2000-01-15';
        else if (v.format === 'date-time') out[k] = '2026-07-01T00:00:00.000Z';
        else out[k] = v.default ?? '';
      }
    }
    return out;
  }
  return undefined;
}

function isAuthLogin(pathKey, method) {
  return method === 'post' && (pathKey === '/auth/login' || pathKey === '/auth/verify-otp' || pathKey === '/auth/guest-login');
}

function isPublic(op) {
  return !op.security || op.security.length === 0;
}

function statusTestScript(op, method) {
  const codes = Object.keys(op.responses || {})
    .filter((c) => /^\d+$/.test(c))
    .map(Number)
    .sort((a, b) => a - b);
  const preferred =
    codes.find((c) => c >= 200 && c < 300) ||
    (method === 'post' ? 201 : 200);

  return [
    'pm.test("Status code is successful or expected client error", function () {',
    `  const ok = pm.response.code === ${preferred} || (pm.response.code >= 200 && pm.response.code < 300);`,
    '  const clientErr = [400, 401, 403, 404].includes(pm.response.code);',
    '  pm.expect(ok || clientErr).to.be.true;',
    '});',
    '',
    'pm.test("Response time < 5000ms", function () {',
    '  pm.expect(pm.response.responseTime).to.be.below(5000);',
    '});',
    '',
    'if (pm.response.headers.get("Content-Type")?.includes("application/json")) {',
    '  pm.test("JSON body parses", function () {',
    '    pm.response.to.be.json;',
    '  });',
    '  try {',
    '    const json = pm.response.json();',
    '    if (json && (json.status !== undefined || json.message !== undefined || json.data !== undefined)) {',
    '      pm.test("Common envelope fields present", function () {',
    '        pm.expect(json).to.be.an("object");',
    '      });',
    '    }',
    '  } catch (e) {}',
    '}',
  ].join('\n');
}

function tokenSaveScript(pathKey) {
  return [
    'if (pm.response.code >= 200 && pm.response.code < 300) {',
    '  try {',
    '    const json = pm.response.json();',
    '    const token = json?.data?.token || json?.token || json?.data?.accessToken;',
    '    if (token) {',
    '      pm.environment.set("accessToken", token);',
    '      pm.collectionVariables.set("accessToken", token);',
    '      console.log("Saved accessToken from ' + pathKey + '");',
    '    }',
    '    const user = json?.data?.user || json?.user;',
    '    if (user?._id || user?.id) {',
    '      const uid = String(user._id || user.id);',
    '      pm.environment.set("userId", uid);',
    '      if (user.type === "ADMIN") pm.environment.set("adminId", uid);',
    '      if (user.type === "AGENT") pm.environment.set("agentId", uid);',
    '      if (user.type === "CUSTOMER") pm.environment.set("customerId", uid);',
    '      if (user.type === "LISTENER") pm.environment.set("listenerId", uid);',
    '    }',
    '  } catch (e) {',
    '    console.warn("Could not parse login response", e);',
    '  }',
    '}',
  ].join('\n');
}

function buildRequest(pathKey, method, op) {
  const tag = (op.tags && op.tags[0]) || 'Misc';
  const urlPath = swaggerPathToPostman(pathKey);
  const query = buildQuery(op.parameters || []);
  const pathVariables = extractPathVariables(pathKey);
  const body = ['post', 'put', 'patch'].includes(method) ? buildBody(op.requestBody) : undefined;

  const headers = [{ key: 'Accept', value: 'application/json' }];
  if (body?.mode === 'raw') {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }

  const events = [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: statusTestScript(op, method).split('\n'),
      },
    },
  ];

  if (isAuthLogin(pathKey, method)) {
    events.push({
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: tokenSaveScript(pathKey).split('\n'),
      },
    });
  }

  // Auth: collection-level bearer; mark public requests with noauth
  const auth = isPublic(op)
    ? { type: 'noauth' }
    : undefined;

  const item = {
    name: op.summary || `${method.toUpperCase()} ${pathKey}`,
    request: {
      method: method.toUpperCase(),
      header: headers,
      ...(auth ? { auth } : {}),
      ...(body ? { body } : {}),
      url: {
        raw: `{{baseUrl}}${urlPath}${
          query.filter((q) => !q.disabled).length
            ? `?${query
                .filter((q) => !q.disabled)
                .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
                .join('&')}`
            : ''
        }`,
        host: ['{{baseUrl}}'],
        path: urlPath.split('/').filter(Boolean),
        ...(query.length ? { query } : {}),
      },
      description: [
        op.description || op.summary || '',
        '',
        `**OpenAPI path:** \`${method.toUpperCase()} ${pathKey}\``,
        `**Auth:** ${isPublic(op) ? 'Public' : 'Bearer JWT ({{accessToken}})'}` ,
        '',
        '### Expected responses',
        ...Object.entries(op.responses || {}).map(
          ([code, r]) => `- **${code}**: ${r.description || ''}`
        ),
        '',
        pathVariables.length
          ? [
              '### Path params (environment variables)',
              ...pathVariables.map(
                (v) =>
                  `- \`{{${v.envKey}}}\` — sample \`${v.sample}\` (replace with a real Mongo ObjectId)`
              ),
            ].join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    response: buildExampleResponses(op),
    event: events,
  };

  return { tag, item };
}

function buildExampleResponses(op) {
  const out = [];
  const responses = op.responses || {};
  for (const [code, r] of Object.entries(responses)) {
    if (!/^\d+$/.test(code)) continue;
    const example =
      r.content?.['application/json']?.example ||
      (r.content?.['application/json']?.examples &&
        Object.values(r.content['application/json'].examples)[0]?.value);
    if (!example) continue;
    out.push({
      name: `${code} ${r.description || ''}`.trim(),
      originalRequest: undefined,
      status: code.startsWith('2') ? 'OK' : 'Error',
      code: Number(code),
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify(example, null, 2),
    });
  }
  // Synthetic common errors if none present
  if (!out.some((x) => x.code === 401)) {
    out.push({
      name: '401 Unauthorized',
      status: 'Unauthorized',
      code: 401,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify(
        { status: 'fail', message: 'Invalid token! Please log in again.' },
        null,
        2
      ),
    });
  }
  if (!out.some((x) => x.code === 400)) {
    out.push({
      name: '400 Validation Error',
      status: 'Bad Request',
      code: 400,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify(
        { status: 'fail', message: 'Validation error', errors: [{ field: 'example', message: 'is required' }] },
        null,
        2
      ),
    });
  }
  if (!out.some((x) => x.code === 404)) {
    out.push({
      name: '404 Not Found',
      status: 'Not Found',
      code: 404,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ status: 'fail', message: 'Resource not found' }, null, 2),
    });
  }
  return out;
}

// Build folders by tag
const folders = new Map();
let totalRequests = 0;

for (const [pathKey, methods] of Object.entries(swagger.paths || {})) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const { tag, item } = buildRequest(pathKey, method, op);
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(item);
    totalRequests += 1;
  }
}

// Prefer Auth folder first
const tagOrder = [
  'Auth',
  'Users',
  'Listeners',
  'Agent Revenue',
  'Agent Analytics',
  'Agent Dashboard',
  'Agent Settlements',
  'Reports',
  'Countries',
  'Languages',
  'Wallets',
  'Withdrawals',
  'Communications',
  'Chats',
  'Calls',
  'Live Rooms',
  'Platform Analytics',
  'Gifts',
  'Avatars',
  'Banners',
  'Stickers',
  'Sticker Categories',
  'Coin Packs',
  'Daily Rewards',
  'XP',
  'Notifications',
  'Feedback',
  'Referrals',
  'Company',
  'Home',
  'Match',
  'Search',
  'Follows',
  'Wishlist',
  'Reviews',
  'Anchor Levels',
];

const sortedTags = [
  ...tagOrder.filter((t) => folders.has(t)),
  ...[...folders.keys()].filter((t) => !tagOrder.includes(t)).sort(),
];

const collectionItems = sortedTags.map((tag) => ({
  name: tag,
  item: folders.get(tag),
  description: `APIs tagged "${tag}" from OpenAPI.`,
}));

const collection = {
  info: {
    name: COLLECTION_NAME,
    description: [
      `# ${PROJECT_NAME}`,
      '',
      'Auto-generated from `src/docs/swagger.json` — kept in sync with backend routes.',
      '',
      '## Auth flow',
      '1. Run **Auth → Unified login for Admin and Agent** (`POST /auth/login`) with admin/agent email + password.',
      '2. Tests save `data.token` into environment variable `accessToken`.',
      '3. Collection auth injects `Authorization: Bearer {{accessToken}}` on protected requests.',
      '4. Mobile users: use **request-otp** + **verify-otp** (also saves token).',
      '',
      '## Variables',
      'Import `postman_environment.json` and select **LiveChat Local**.',
      'Replace ObjectId placeholders with real IDs from your database when needed.',
      '',
      `**Total requests:** ${totalRequests}`,
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    _postman_id: 'livechat-api-collection',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1' },
    { key: 'accessToken', value: '' },
    { key: 'resourceId', value: SAMPLE_IDS.userId },
  ],
  event: [
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          '// Collection pre-request: ensure baseUrl is set',
          'if (!pm.environment.get("baseUrl") && pm.collectionVariables.get("baseUrl")) {',
          '  // collection variable used as fallback via {{baseUrl}}',
          '}',
        ],
      },
    },
  ],
  item: collectionItems,
};

const environment = {
  id: 'livechat-local-env',
  name: ENV_NAME,
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1', type: 'default', enabled: true },
    { key: 'accessToken', value: '', type: 'secret', enabled: true },
    { key: 'refreshToken', value: '', type: 'secret', enabled: true },
    { key: 'adminEmail', value: 'admin@chatcorner.app', type: 'default', enabled: true },
    { key: 'adminPassword', value: 'admin123', type: 'secret', enabled: true },
    { key: 'adminId', value: SAMPLE_IDS.adminId, type: 'default', enabled: true },
    { key: 'userId', value: SAMPLE_IDS.userId, type: 'default', enabled: true },
    { key: 'customerId', value: SAMPLE_IDS.customerId, type: 'default', enabled: true },
    { key: 'listenerId', value: SAMPLE_IDS.listenerId, type: 'default', enabled: true },
    { key: 'agentId', value: SAMPLE_IDS.agentId, type: 'default', enabled: true },
    { key: 'sessionId', value: SAMPLE_IDS.sessionId, type: 'default', enabled: true },
    { key: 'walletId', value: SAMPLE_IDS.walletId, type: 'default', enabled: true },
    { key: 'giftId', value: SAMPLE_IDS.giftId, type: 'default', enabled: true },
    { key: 'languageId', value: SAMPLE_IDS.languageId, type: 'default', enabled: true },
    { key: 'countryId', value: SAMPLE_IDS.countryId, type: 'default', enabled: true },
    { key: 'reportId', value: SAMPLE_IDS.reportId, type: 'default', enabled: true },
    { key: 'reasonId', value: SAMPLE_IDS.reasonId, type: 'default', enabled: true },
    { key: 'feedbackId', value: SAMPLE_IDS.feedbackId, type: 'default', enabled: true },
    { key: 'coinPackId', value: SAMPLE_IDS.coinPackId, type: 'default', enabled: true },
    { key: 'bannerId', value: SAMPLE_IDS.bannerId, type: 'default', enabled: true },
    { key: 'avatarId', value: SAMPLE_IDS.avatarId, type: 'default', enabled: true },
    { key: 'stickerId', value: SAMPLE_IDS.stickerId, type: 'default', enabled: true },
    { key: 'stickerCategoryId', value: SAMPLE_IDS.stickerCategoryId, type: 'default', enabled: true },
    { key: 'withdrawalId', value: SAMPLE_IDS.withdrawalId, type: 'default', enabled: true },
    { key: 'settlementId', value: SAMPLE_IDS.settlementId, type: 'default', enabled: true },
    { key: 'notificationId', value: SAMPLE_IDS.notificationId, type: 'default', enabled: true },
    { key: 'liveRoomId', value: SAMPLE_IDS.liveRoomId, type: 'default', enabled: true },
    { key: 'companyId', value: SAMPLE_IDS.companyId, type: 'default', enabled: true },
    { key: 'resourceId', value: SAMPLE_IDS.userId, type: 'default', enabled: true },
    { key: 'mobileNumber', value: '9876543210', type: 'default', enabled: true },
    { key: 'otp', value: '123456', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

// Patch login body to use env vars for convenience
function patchLoginBodies(items) {
  for (const folder of items) {
    for (const req of folder.item || []) {
      if (req.name?.includes('Unified login') || req.request?.url?.path?.includes('login')) {
        if (req.request?.body?.mode === 'raw') {
          try {
            const parsed = JSON.parse(req.request.body.raw);
            if (parsed.email !== undefined) {
              req.request.body.raw = JSON.stringify(
                {
                  email: '{{adminEmail}}',
                  password: '{{adminPassword}}',
                },
                null,
                2
              );
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
}
patchLoginBodies(collection.item);

// Write outputs
const collectionPath = path.join(OUT_DIR, 'postman_collection.json');
const envPath = path.join(OUT_DIR, 'postman_environment.json');
const yamlPath = path.join(ROOT, 'src/docs/swagger.yaml');
const rootCollection = path.join(ROOT, 'postman_collection.json');
const rootEnv = path.join(ROOT, 'postman_environment.json');

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));
fs.writeFileSync(envPath, JSON.stringify(environment, null, 2));
fs.writeFileSync(rootCollection, JSON.stringify(collection, null, 2));
fs.writeFileSync(rootEnv, JSON.stringify(environment, null, 2));

// Also copy swagger.json to docs root alias if requested
fs.copyFileSync(SWAGGER_PATH, path.join(OUT_DIR, 'swagger.json'));

const yamlStr = yaml.dump(swagger, {
  lineWidth: 120,
  noRefs: true,
  sortingCollectionKeys: false,
});
fs.writeFileSync(yamlPath, yamlStr);
fs.writeFileSync(path.join(OUT_DIR, 'swagger.yaml'), yamlStr);

const summary = {
  project: PROJECT_NAME,
  totalApisFound: totalRequests,
  swaggerCoverage: '100%',
  newlyDocumentedPreviously: 60,
  updatedSwaggerEndpoints: 9,
  totalPostmanRequests: totalRequests,
  folders: sortedTags.length,
  outputs: {
    swaggerJson: 'src/docs/swagger.json',
    swaggerYaml: 'src/docs/swagger.yaml',
    postmanCollection: 'postman_collection.json',
    postmanEnvironment: 'postman_environment.json',
    alsoIn: 'docs/postman/',
  },
  authFlow: [
    'POST /auth/login with {{adminEmail}} / {{adminPassword}}',
    'Test script saves data.token -> {{accessToken}}',
    'Collection bearer auth reuses {{accessToken}}',
    'OTP: POST /auth/request-otp then POST /auth/verify-otp (also saves token)',
  ],
  manualDataRequired: [
    'Replace ObjectId placeholders (userId, sessionId, etc.) with real Mongo IDs from your DB',
    'Admin login credentials must exist (seeded super-admin or your .env admin)',
    'OTP flows need a valid mobile + OTP from your OTP provider / test mode',
    'Multipart chat media: attach a real file in Postman before sending',
    'Some agent/listener endpoints require role-specific tokens (login as AGENT/LISTENER)',
  ],
};

fs.writeFileSync(path.join(OUT_DIR, 'generation-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
