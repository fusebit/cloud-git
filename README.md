# Cloud-git: Node.js git server for cloud-native applications

Cloud-git is a pure-JavaScript git server you can expose as part of the HTTP APIs of your app: 

* Expose a Git repository as an Express route of your application. 
* Pure JavaScript, no dependencies on native git libraries. 
* Extensible to use any cloud-native storage like AWS S3 or Azure Blob Storage, no dependnecy on the file system. 
* HTTP or HTTPS.
* Read/write (push/pull). 
* Supports authentication.
* Can be used with regular git CLI.

Done with love by [Fusebit.io](https://fusebit.io). 

## Getting started

Install Express and cloud-git:

```
npm i express
npm i @fusebit/cloud-git
```

In server.js: 

```javascript
const Express = require("express");
const { MemoryGitRepository } = require("@fusebit/cloud-git");

const app = Express();
app.use("/git", new MemoryGitRepository().createExpress(Express));

require("http").createServer(app).listen(3000);
```

Start the Express app: 

```
node server.js
```

And party on: 

```
mkdir test
cd test
git init
echo "Hello, world" > hello
git add .
git commit -am "first checkin"
git remote add origin http://localhost:3000/git
git push origin master
```

```
mkdir test2
cd test2
git remote add origin http://localhost:3000/git
git pull
```

## Running tests

## APIs

