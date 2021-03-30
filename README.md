# Cloud-git: Node.js git server for cloud-native applications

Cloud-git is a 100% JavaScript git server you can expose as part of the HTTP APIs of your app: 

* Expose a Git repository as an Express route of your application. 
* Pure JavaScript, no dependencies on native git libraries. 
* Extensible to use any cloud-native storage like AWS S3, no dependnecy on the file system. 
* HTTP or HTTPS.
* Read/write (push/pull). 
* Supports authentication.
* Can be used with regular git CLI.

For developers by developers at [Fusebit.io](https://fusebit.io). 

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

To run tests, you need a configured git CLI in the environment. Tested with git CLI 2.24.3.

```
npm test
```

If you run into issues, you can display more tracing with:

```
GIT_DEBUG=1 npm test
```

## APIs

The cloud-git module provides a *GitRepository* abstract base class that implements the smart HTTP git protocol and exposes a number of extensibility points as methods of the class. Those methods abstract the storage mechanism of the git repository and are intended to be overriden in derived classes. The cloud-git module provides one such derived class, *MemoryGitRepository*, which supports a transient, in-memory storage and is intended for testing purposes and as a reference implementation. 

### Using in Express

The *GitRepositry* base class provides the *createExpress* method which returns an Express router intended to be mounted in the selected location of the URL space of your app. The example below shows how to use the *MemoryGitRepository* instance, but generally you would create your own class deriving from *GitRepository* and use that instead:

```javascript
const Express = require("express");
const { MemoryGitRepository } = require("@fusebit/cloud-git");

const app = Express();
app.use("/git", new MemoryGitRepository().createExpress(Express));

require("http").createServer(app).listen(3000);
```

The example above will host the git repository at http://localhost:3000/git - you can use it as remote URL with standard git clients. 

You can also host the repository logic at a parameterized URL path. This is useful when your API supports multiple named git repositories, for example: 

```javascript
app.use("/git/:repositoryName", new MemoryGitRepository().createExpress(Express))
```

The request object is passed to all relevant extensibility points of the *GitRepository* base class, which can then extract the necessary parameters from `req.params`. The *MemoryGitRepository* class does not provide support for multiple repositories. 

### Implementing your own storage

The *GitRepository* base class exposes a few methods that must be implemented in derived classes to support the storage mechanism of your choice:

```javascript
class GitRepository {
    // Must be overriden
    async getRefs(req) {}
    async receivePack(req, commands, objects) {}
    async getObject(req, hash) {}
    // May be overriden
    async getHeadRef(req) {}
    async authorize(req, res, next) {}
    async getReceivePackSuccessMessage(req, commands, objects) {}
    async getUploadPackSuccessMessage(req, objects)
}
```

The minimal implementation would then look like this: 

```javascript
const { GitRepository } = require("@fusebit/cloud-git");

class MySqlGitRepository extends GitRepository {
    async getRefs(req) { /*...*/ }
    async receivePack(req, commands, objects) { /*...*/ }
    async getObject(req, sha) { /*...*/ }
}
```

Below is the documentation of individual methods. 

#### async getRefs(req)

The method must return all git references stored on the server. The array has the following schema: 

```javascript
[
    { "ref": "{refName}", "sha": "{sha}" },
    ...
]
```

For example: 

```javascript
[
    { "ref": "refs/heads/main", "sha": "fd31bdda597916d85b2a35f6b8f2d91b6159448c" }
]
```

If you are starting from an empty repository, this array would initially contain no elements, and would be populated from the *receivePack* method described next. 

#### async receivePack(req, commands, objects)

This method is called when changes in the repository are requested by the client, typically as a result of the *git push* command. 

The *req* represents the request and can be used to access *req.params*. 

The *commands* is an array of objects describing the changes in the repository requested by the caller. The array has the following schema:

```javascript
[
    { "srcId": "{sha}", "destId": "{sha}", "ref": "{refName}" },
    ...
]
```

Each element in the array represents a change in the sha value from *srcId* to *destId* that the specified git ref needs to point to. There is a special "zero" *sha* value consisting of 40 `0` characters which can be used either as *srcId* or *destId*, as follows:

* If *srcId* is a zero sha, a new ref is being created to point to *destId*. 
* If *destId* is a zero sha, an existing ref pointing to *srcId* is being deleted.
* Otherwise, an existing ref is being updated to point to *destId* instead of *srcId*. 

The *GitRepository* class provides a convenience method *this.isZeroSha(sha)* that can be used to test for the zero sha. 

The *objects* parameter is an array containing all new objects the client has sent to the server which need to be stored. The array has the following schema: 

```javascript
[
    { "sha": "{sha}", "objectType": "blob|tree|commit|tag", "data": <Buffer> },
    ...
]
```

The *sha* uniquely identifies the object (it is a hex-encoded SHA1 value of the *data* with addition of some metadata). The *objectType* describes the type of an object as one of the four core types git supports. The *data* is a buffer containing the actual object data. 

#### async getObject(req, sha)

This method must retrieve from storage and return a previously stored object identified with *sha* (a 40 character hex encoded string). The *req* represents the request and can be used to access *req.params*. 

The method must return an object with the same schema as the one previously provided to *receivePack*, or throw an exception if the requested object does not exist:

```javascript
{ "sha": "{sha}", "objectType": "blob|tree|commit|tag", "data": <Buffer> }
```

#### async getHeadRef(req)

This method can optionally return the ref name of the HEAD of the repository. This will be sent as a hint to clients who clone the repository so that they can establish a default branch. If you return *undefined*, no hint will be provided, and the client will need to manually select their branch after cloning. You would typically return something like `ref/heads/main`, depending on the setup of your repository. 

#### async authorize(req, res, next) {}

This method allows authorizing access to the git repository. The same effect can be accomplished by simply adding Express middleware to the route prior to the repository handler, but the *authorize* method has been provided in case you want to encapsulate the authorization logic with the rest of your implementation. The default base class implementation of *GitRepository.authorize* simply calls *next()*, which means unauthorized access is allowed. 

If you want to protect your repository and enable standard git CLI to work with it out of the box, you will need to use Basic authentication. Your implementation of *authorize* would then look like this:

```javascript
class MySqlGitRepository extends GitRepository {
    async authorize(req, res, next) {
        if (!req.headers.authorization) {
            res.status(401).set("www-authenticate", 'Basic realm="MyRealm').end();
        } else {
            // Validate req.headers.authorization and either respond with HTTP 403
            // or call next() to grant access.
            next();
        }   
    }
    // ...
}
```

The *www-authenticate* response header on the HTTP 401 response provides a hint for the git CLI to ask the user for username and password and retry the request, unless the credentials are already preconfigured on the client. There is a variety of ways credentials can be specified in git CLI, please consult the documentation. 

#### async getReceivePackSuccessMessage(req, commands, objects)

This method allows the server to send a custom message to the client after a successful *git push* operation. The standard git CLI normally displays this message in the console, but the client ultimately controls if this happens (in particular, the user may have disabled these messages). If you want to send a custom message, return a string (possibly multi-line), otherwhise return *undefined*. The *commands* and *objects* parameters are the same as for the *receivePack* method.

#### async getUploadPackSuccessMessage(req, objects)

This method allows the server to send a custom message to the client after a successful *git pull* or *git fetch* operation. The concept is similar to *getReceivePackSuccessMessage*. 

## Acknowledgements

There is no single, comprehensive documentation of the git protocol out there. The cloud-git implementation involved an archaelogical effort to uncover bits and pieces scattered across the plains of the internet to put together a more comprehensive picture. To give credit where it is due, here are some of the sources we relied on:

* [Alex Blewitt](https://twitter.com/alblue) provides an excellent introduction to the git object model in his blog series on [objects](https://alblue.bandlem.com/2011/08/git-tip-of-week-objects.html), [trees](https://alblue.bandlem.com/2011/08/git-tip-of-week-trees.html), and [commits](https://alblue.bandlem.com/2011/08/git-tip-of-week-trees.html). Also check out his other [git-related blog posts](https://alblue.bandlem.com/Tag/git/).  
* [Stefan Saasen](https://twitter.com/stefansaasen) has gone through a similar discovery journey when implementing a git client in Haskell. His [Reimplementing "git clone" in Haskell](https://stefan.saasen.me/articles/git-clone-in-haskell-from-the-bottom-up/#format_of_the_delta_representation) blog post provides a wealth of information on all layers of the protocol. In particular, the examples of the [deltified encoding](https://stefan.saasen.me/articles/git-clone-in-haskell-from-the-bottom-up/#delta-encoding) helped fill gaps in the protocol documentation. 
* [Mincong Huang](https://twitter.com/mincong_h) walks through a few wire-level examples in his [Git: Communication over HTTP](https://mincong.io/2018/05/04/git-and-http/) blog post; very useful. 
* The [git http protocol](https://git-scm.com/docs/http-protocol) provides an overview of the HTTP protocol for git. 
* The [common protocol elements](https://git-scm.com/docs/protocol-common) specifies the basic ABNF terms the rest of the protocol layers depend on. 
* The [pack format](https://git-scm.com/docs/pack-format) describes the syntax of the pack files, which is a binary format used to transfer compressed git objects. 
* The Git Book has some useful content of the [format of the packfile](http://shafiul.github.io/gitbook/7_the_packfile.html) and [transfer protocols](http://shafiul.github.io/gitbook/7_transfer_protocols.html).
