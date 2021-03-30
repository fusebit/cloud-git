const Protocol = require('./protocol');
const fusebit = require('./fusebit');

class GitRepository {
  constructor() {}

  isZeroId(id) {
    return id === Protocol.ZeroIdStr;
  }

  async authorize(req, res, next) {
    // if (!req.headers.authorization) {
    //   res.status(401).set("www-authenticate", 'Basic realm="MyRealm').end();
    // } else {
    //   // Validate req.headers.authorization
    //   next();
    // }
    next();
  }

  async getRefs(req) {
    throw new Error('Not Implemented');
  }

  async getHeadRef(req) {
    throw new Error('Not Implemented');
  }

  async receivePack(req, commands, objects) {
    throw new Error('Not Implemented');
  }

  async getObject(req, ha) {
    throw new Error('Not Implemented');
  }

  async getReceivePackSuccessMessage(req, commands, objects) {
    return `${fusebit}Received ${commands.length} ref${commands.length !== 1 ? 's' : ''} and ${objects.length} object${
      objects.length !== 1 ? 's' : ''
    }\n\n`;
  }

  async getUploadPackSuccessMessage(req, objects) {
    return fusebit;
  }

  createExpress(express) {
    const router = express.Router();

    router.get('/info/refs', this.authorize, Protocol.handleGetRefs(this));
    router.post('/git-upload-pack', this.authorize, Protocol.handlePost(this, 'git-upload-pack'));
    router.post('/git-receive-pack', this.authorize, Protocol.handlePost(this, 'git-receive-pack'));

    return router;
  }
}

module.exports = GitRepository;
