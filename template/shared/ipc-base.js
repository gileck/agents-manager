"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannel = void 0;
const createChannel = (namespace, action) => {
    return `${namespace}:${action}`;
};
exports.createChannel = createChannel;
//# sourceMappingURL=ipc-base.js.map