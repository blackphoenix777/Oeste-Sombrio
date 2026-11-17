// Publishes only the immutable, owner-approved 1.4.4 payload. No build or signing keys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = 'blackphoenix777/Oeste-Sombrio';
const exe = 'Dark.West.Character.Sheet_1.4.4_x64-setup.exe';
const expected = {
  [exe]: '1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962',
  [exe + '.sig']: '301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155',
  'latest.json': '479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d'
};
function verify(files) {
  const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(config.version, '1.4.4');
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).version, '1.4.4');
  for (const [name, hash] of Object.entries(expected)) {
    assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'), hash, name);
  }
  const manifest = JSON.parse(files['latest.json']);
  assert.equal(manifest.version, '1.4.4');
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64']);
  const platform = manifest.platforms['windows-x86_64'];
  assert.equal(platform.url, `https://github.com/${repo}/releases/download/v1.4.4/${exe}`);
  assert.equal(platform.signature, files[exe + '.sig'].toString('utf8').trim());
  const publicText = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8');
  const publicBytes = Buffer.from(publicText.trim().split(/\r?\n/)[1], 'base64');
  const signatureText = Buffer.from(platform.signature, 'base64').toString('utf8');
  const lines = signatureText.trim().split(/\r?\n/);
  const signature = Buffer.from(lines[1], 'base64');
  assert.equal(publicBytes.length, 42);
  assert.equal(signature.length, 74);
  assert.equal(signature.subarray(0, 2).toString(), 'ED');
  assert.deepEqual(signature.subarray(2, 10), publicBytes.subarray(2, 10));
  assert.ok(lines[2].startsWith('trusted comment: '));
  const key = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]),
    format: 'der', type: 'spki'
  });
  assert.ok(crypto.verify(null, crypto.createHash('blake2b512').update(files[exe]).digest(), key, signature.subarray(10)), 'Minisign payload');
  assert.ok(crypto.verify(null, Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]), key, Buffer.from(lines[3], 'base64')), 'Minisign trusted comment');
  console.log(JSON.stringify({version: '1.4.4', hashes: expected, minisign: 'PASS', manifest: 'PASS'}));
}
async function publishDraft() {
  assert.equal(process.env.GITHUB_REPOSITORY, repo);
  assert.equal(process.env.GITHUB_REF, 'refs/tags/v1.4.4');
  assert.match(process.env.GITHUB_SHA || '', /^[0-9a-f]{40}$/);
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN required');
  const headers = {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Oeste-Approved-Release'};
  const api = async (route, method = 'GET', body) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${route}`, {method, headers, body: body ? JSON.stringify(body) : undefined});
    if (!r.ok) throw Error(`GitHub ${method} ${route}: HTTP ${r.status}`);
    return r.json();
  };
  const release = await api('/releases/tags/v1.4.4');
  assert.equal(release.target_commitish, process.env.GITHUB_SHA, 'Draft must target exact approved commit');
  assert.equal(release.prerelease, false);
  assert.deepEqual(release.assets.map(a => a.name).sort(), Object.keys(expected).sort());
  const files = {};
  for (const asset of release.assets) {
    assert.equal(asset.state, 'uploaded');
    const r = await fetch(asset.url, {headers: {...headers, Accept: 'application/octet-stream'}});
    if (!r.ok) throw Error(`Asset ${asset.name}: HTTP ${r.status}`);
    files[asset.name] = Buffer.from(await r.arrayBuffer());
    assert.equal(files[asset.name].length, asset.size);
  }
  verify(files);
  if (release.draft) {
    const published = await api(`/releases/${release.id}`, 'PATCH', {draft: false, prerelease: false, make_latest: 'true'});
    assert.equal(published.draft, false);
    console.log(`PUBLISHED ${published.html_url}`);
  } else {
    console.log(`Already published; verified without replacing assets: ${release.html_url}`);
  }
}
if (require.main === module) {
  (async () => {
    if (process.argv[2] === '--publish-draft') return publishDraft();
    const dir = process.argv[2] || 'src-tauri/target/release/bundle/release-upload-1.4.4';
    verify(Object.fromEntries(Object.keys(expected).map(name => [name, fs.readFileSync(path.join(dir, name))])));
  })().catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {verify, expected};
