const GitRepository = require("./GitRepository");
const { debug } = require("./protocol");

class MemoryGitRepository extends GitRepository {
  constructor() {
    super();
    // Starting from an empty repository
    this.refs = {};
    this.refsList = [];
    this.objects = {};
    this.headRef = undefined;
  }

  async getRefs() {
    return this.refsList;
  }

  async getHeadRef() {
    return this.headRef;
  }

  async receivePack(commands, objects) {
    commands.forEach((command) => {
      if (this.isZeroId(command.destId)) {
        delete this.refs[command.ref];
      } else {
        this.refs[command.ref] = command.destId;
      }
    });
    this.refsList = Object.keys(this.refs)
      .sort()
      .map((ref) => ({ ref, sha: this.refs[ref] }));
    objects.forEach((object) => {
      this.objects[object.sha.toString("hex")] = {
        objectType: object.objectType,
        data: object.data,
      };
    });
    if (!this.refs["HEAD"]) {
      ["master", "main"].forEach(
        (b) =>
          (this.headRef = this.refs[`refs/heads/${b}`]
            ? `refs/heads/${b}`
            : this.headRef)
      );
      if (this.headRef) {
        this.refs["HEAD"] = this.refs[this.headRef];
        this.refsList.unshift({ ref: "HEAD", sha: this.refs["HEAD"] });
      }
    }
    debug("HEAD", this.headRef);
    debug("REFS", this.refs);
  }

  async getObject(sha) {
    if (!this.objects[sha]) {
      throw new Error(`Object ${sha} not found.`);
    }
    return this.objects[sha];
  }
}

module.exports = MemoryGitRepository;
