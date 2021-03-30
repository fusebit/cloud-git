const execFile = require('child_process').execFile;
const Fs = require('fs');
const Path = require('path');

exports.run = async (cwd, cmd, expectedOutput) => {
  let args = cmd.split(' ');
  cmd = args.shift();
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (e, o, r) => {
      if (e) {
        if (r) console.error('ERROR', r.toString());
        return reject(e);
      }
      o = o.toString();
      if (expectedOutput) {
        expect(o).toMatch(expectedOutput);
      }
      resolve([o.toString(), r.toString()]);
    });
  });
};

exports.ls = async (cwd, expectedOutput, not) => {
  const o = Fs.readdirSync(cwd).join('\n');
  if (expectedOutput) {
    not ? expect(o).not.toMatch(expectedOutput) : expect(o).toMatch(expectedOutput);
  }
  return o;
};

exports.write = async (cwd, file, content) => {
  Fs.writeFileSync(Path.join(cwd, file), content);
};

exports.read = async (cwd, file, expectedOutput, not) => {
  const o = Fs.readFileSync(Path.join(cwd, file), { encoding: 'utf8' });
  if (expectedOutput) {
    not ? expect(o).not.toMatch(expectedOutput) : expect(o).toMatch(expectedOutput);
  }
  return o;
};

exports.rm = async (cwd, file) => {
  Fs.unlinkSync(Path.join(cwd, file));
};
