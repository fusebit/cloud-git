const Express = require('express');
const { MemoryGitRepository } = require('../lib');

const app = Express();
app.use('/git', new MemoryGitRepository().createExpress(Express));

require('http')
  .createServer(app)
  .listen(3000, () => {
    console.log('Your git repository is available at http://localhost:3000/git');
  });
