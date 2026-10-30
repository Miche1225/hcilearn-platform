// src/presence.js
// Tells open Admin Dashboards the moment a student logs in, logs out or
// comes back online, so "online now" changes within about a second instead
// of waiting for the next check. In-memory: fine for one server (Render).
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open admin tab

function notifyPresence() {
  bus.emit('presence');
}

module.exports = { bus, notifyPresence };
