const Fs = require('fs');
const Path = require('path');
const Uuid = require('uuid');
const { MemoryGitRepository } = require('../lib');
const Express = require('express');
const Http = require('http');
const { run, ls, read, write, rm } = require('./common');

describe('cloud-git', () => {
  let cd1;
  let cd2;
  let server;
  let remoteUrl;

  beforeEach(async () => {
    Fs.mkdirSync((cd1 = Path.join(__dirname, 'tmp', Uuid.v4())), { recursive: true });
    Fs.mkdirSync((cd2 = Path.join(__dirname, 'tmp', Uuid.v4())), { recursive: true });
    const app = Express();
    app.use('/git', new MemoryGitRepository().createExpress(Express));
    let tmp = Http.createServer(app);
    return new Promise((resolve, reject) => {
      tmp.on('error', reject);
      tmp.listen(process.env.PORT || 3000, () => {
        remoteUrl = `http://localhost:${process.env.PORT || 3000}/git`;
        tmp.removeListener('error', reject);
        server = tmp;
        resolve();
      });
    });
  });

  afterEach(async () => {
    Fs.rmSync(cd1, { recursive: true, force: true });
    Fs.rmSync(cd2, { recursive: true, force: true });
    if (server) {
      return new Promise((resolve) => {
        server.close(() => {
          server = undefined;
          remoteUrl = undefined;
          resolve();
        });
      });
    }
  });

  test('git init1/commit1/push1 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
  });

  test('git init1/commit1/push1/clone2 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
  });

  test('git init1/commit1/push1/clone2/change2/commit2/push2 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
    await write(cd2, 'file1', 'change');
    await run(cd2, 'git commit -am "second"', /second/g);
    await run(cd2, `git push origin ${branch}`);
  });

  test('git init1/commit1/push1/clone2/change2/commit2/push2/pull1 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
    await write(cd2, 'file1', 'change');
    await write(cd2, 'file2', 'foo');
    await run(cd2, 'git add .');
    await run(cd2, 'git commit -am "second"', /second/g);
    await run(cd2, `git push origin ${branch}`);
    // cd1
    await run(cd1, `git pull origin ${branch}`);
    await read(cd1, 'file1', /change/);
    await read(cd1, 'file2', /foo/);
  });

  test('git init1/commit1/push1/clone2/delete2/commit2/push2/pull1 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
    await rm(cd2, 'file1');
    await run(cd2, 'git commit -am "second"', /second/g);
    await run(cd2, `git push origin ${branch}`);
    // cd1
    await run(cd1, `git pull origin ${branch}`);
    await ls(cd2, /file1/g, true);
  });

  test('git init1/commit1/push1/clone2/branch2/change2/commit2/push2/fetch1 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
    await run(cd2, 'git checkout -b dev');
    await write(cd2, 'file1', 'change');
    await write(cd2, 'file2', 'foo');
    await run(cd2, 'git add .');
    await run(cd2, 'git commit -am "second"', /second/g);
    await run(cd2, `git push origin dev`);
    // cd1
    await run(cd1, `git fetch`);
    await read(cd1, 'file1', /change/, true);
    await ls(cd1, /foo/, true);
    await run(cd1, 'git checkout dev');
    await read(cd1, 'file1', /change/);
    await ls(cd1, /file2/);
    await read(cd1, 'file2', /foo/);
  });

  test('git init1/commit1/push1/clone2/branch2/delete2/change2/commit2/push2/fetch1/merge1/delete1/change1/commmit1/pull2 works', async () => {
    // cd1
    await run(cd1, 'git init', /Initialized empty Git repository/);
    await write(cd1, 'file1', '');
    await ls(cd1, /file1/g);
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "first"', /first/g);
    await run(cd1, `git remote add origin ${remoteUrl}`);
    let [branch] = await run(cd1, 'git rev-parse --abbrev-ref HEAD');
    branch = branch.trim();
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git clone ${remoteUrl} .`);
    await ls(cd2, /file1/g);
    await run(cd2, 'git checkout -b dev');
    await rm(cd2, 'file1');
    await write(cd2, 'file2', 'foo');
    await run(cd2, 'git add .');
    await run(cd2, 'git commit -am "second"', /second/g);
    await run(cd2, `git push origin dev`);
    // cd1
    await run(cd1, `git fetch`);
    await ls(cd1, /file1/g);
    await ls(cd1, /file2/g, true);
    await run(cd1, 'git checkout dev');
    await ls(cd1, /file1/g, true);
    await ls(cd1, /file2/g);
    await read(cd1, 'file2', /foo/);
    await run(cd1, `git checkout ${branch}`);
    await run(cd1, `git merge origin/dev -m "merge"`);
    await ls(cd1, /file1/g, true);
    await ls(cd1, /file2/g);
    await read(cd1, 'file2', /foo/);
    await write(cd1, 'file2', 'bar');
    await write(cd1, 'file3', 'baz');
    await run(cd1, 'git add .');
    await run(cd1, 'git commit -am "third"', /third/g);
    await run(cd1, `git push origin ${branch}`);
    // cd2
    await run(cd2, `git checkout ${branch}`);
    await run(cd2, `git pull origin ${branch}`);
    await ls(cd2, /file1/g, true);
    await ls(cd2, /file2/g);
    await ls(cd2, /file3/g);
    await read(cd2, 'file2', /bar/);
    await read(cd2, 'file3', /baz/);
  });
});
