const execFileSync = require('child_process').execFileSync;
const Fs = require('fs');
const Path = require('path');
const Uuid = require('uuid');
const { run } = require('./common');

describe('preconditions', () => {
  let cd1;

  beforeEach(async () => {
    Fs.mkdirSync((cd1 = Path.join(__dirname, 'tmp', Uuid.v4())), { recursive: true });
  });

  afterEach(async () => {
    Fs.rmSync(cd1, { recursive: true, force: true });
  });

  test('git is available', async () => {
    const output = execFileSync('git', ['version']).toString();
    expect(output).toMatch(/version/);
  });

  test('git init works', async () => {
    const [output] = await run(cd1, 'git init');
    expect(output).toMatch(/Initialized empty Git repository/);
  });
});
