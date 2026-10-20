'use strict';
// Trusted, build-time extensions. Authentication is supplied by app.js.
const extensions = [require('./history')];
function registerExtensions(app, basePath) {
    for (const extension of extensions) app.use(basePath, extension.routes);
}
function registerExtensionTools(server, context, tools) {
    for (const extension of extensions)
        extension.registerTools?.(server, context, tools);
}
module.exports = { registerExtensions, registerExtensionTools };
