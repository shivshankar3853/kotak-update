const EventEmitter = require("events");

const sessionBus = new EventEmitter();

let session = {
  token: null,
  sid: null,
  baseUrl: null
};

function setSession(data, options = {}) {
  const { emit = true } = options;

  const nextSession = {
    ...session,
    ...data
  };

  const hasChanged =
    nextSession.token !== session.token ||
    nextSession.sid !== session.sid ||
    nextSession.baseUrl !== session.baseUrl;

  if (!hasChanged) {
    return session;
  }

  session = nextSession;

  
  if (emit) {
    sessionBus.emit("sessionUpdated", session);
  }

  return session;
}

function getSession() {
  return session;
}

module.exports = {
  setSession,
  getSession,
  sessionBus
};