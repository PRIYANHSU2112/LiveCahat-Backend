import fs from 'fs';
import path from 'path';

const routesDir = './src/routes';
const index = fs.readFileSync('./src/routes/index.routes.js', 'utf8');

const importMap = {};
const importRe = /import\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g;
let mm;
while ((mm = importRe.exec(index))) importMap[mm[1]] = mm[2];

const mounts = [];
const mountRe = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
while ((mm = mountRe.exec(index))) {
  mounts.push({ prefix: mm[1], varName: mm[2], file: importMap[mm[2]] });
}

const full = [];
for (const mount of mounts) {
  const content = fs.readFileSync(path.join(routesDir, mount.file), 'utf8');
  const re = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi;
  let m;
  while ((m = re.exec(content))) {
    const joined =
      m[2] === '/'
        ? mount.prefix
        : `${mount.prefix}${m[2].startsWith('/') ? m[2] : `/${m[2]}`}`;
    const normalized = joined.replace(/\/+/g, '/').replace(/\/$/, '') || mount.prefix;
    full.push({
      method: m[1].toUpperCase(),
      path: normalized,
      file: mount.file,
    });
  }
}

full.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const swagger = JSON.parse(fs.readFileSync('./src/docs/swagger.json', 'utf8'));
const swaggerOps = [];
for (const [p, methods] of Object.entries(swagger.paths || {})) {
  for (const method of Object.keys(methods)) {
    if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
      swaggerOps.push({ method: method.toUpperCase(), path: p });
    }
  }
}

const toBrace = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const routeSet = new Map(full.map((r) => [`${r.method} ${toBrace(r.path)}`, r]));
const swaggerSet = new Map(swaggerOps.map((r) => [`${r.method} ${toBrace(r.path)}`, r]));

const missing = [];
const documented = [];
for (const [k] of routeSet) {
  if (swaggerSet.has(k)) documented.push(k);
  else missing.push(k);
}
const extra = [];
for (const [k] of swaggerSet) {
  if (!routeSet.has(k)) extra.push(k);
}

fs.mkdirSync('./reports', { recursive: true });
fs.writeFileSync('./reports/route-inventory.json', JSON.stringify(full, null, 2));
fs.writeFileSync(
  './reports/swagger-gap.json',
  JSON.stringify(
    {
      totalRoutes: full.length,
      swaggerOps: swaggerOps.length,
      documented: documented.length,
      missingCount: missing.length,
      extraCount: extra.length,
      missing,
      extra,
      mounts,
    },
    null,
    2
  )
);

console.log('TOTAL_ROUTES', full.length);
console.log('SWAGGER_OPS', swaggerOps.length);
console.log('DOCUMENTED', documented.length);
console.log('MISSING', missing.length);
console.log('SWAGGER_ONLY', extra.length);
console.log('\n--- MISSING ---');
missing.forEach((x) => console.log(x));
console.log('\n--- SWAGGER ONLY ---');
extra.forEach((x) => console.log(x));
