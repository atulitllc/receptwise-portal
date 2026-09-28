'use strict';
class NotConfiguredError extends Error {
  constructor(service, vars) {
    super(service + ' is not connected yet. Missing: ' + vars.join(', ') + '.');
    this.code = 'NOT_CONFIGURED';
    this.service = service;
    this.missing = vars;
    this.status = 409;
  }
}
class UpstreamError extends Error {
  constructor(service, status, body) {
    super(service + ' returned HTTP ' + status + ': ' + (typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 500));
    this.code = 'UPSTREAM';
    this.status = 502;
    this.upstreamStatus = status;
  }
}
module.exports = { NotConfiguredError, UpstreamError };
