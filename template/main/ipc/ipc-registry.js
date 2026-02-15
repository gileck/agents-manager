"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandler = registerIpcHandler;
exports.removeIpcHandler = removeIpcHandler;
exports.validateInput = validateInput;
exports.validateId = validateId;
const electron_1 = require("electron");
function registerIpcHandler(channel, handler) {
    electron_1.ipcMain.handle(channel, handler);
}
function removeIpcHandler(channel) {
    electron_1.ipcMain.removeHandler(channel);
}
function validateInput(input, requiredFields) {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid input: must be an object');
    }
    for (const field of requiredFields) {
        if (!(field in input)) {
            throw new Error(`Invalid input: missing required field '${field}'`);
        }
    }
}
function validateId(id, fieldName = 'id') {
    if (typeof id !== 'string' || !id.trim()) {
        throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
    }
    return id;
}
//# sourceMappingURL=ipc-registry.js.map