'use strict';

const
  KuzzleAbstractProtocol = require('./abstract/common'),
  _routes = require('./routes.json');


class HttpWrapper extends KuzzleAbstractProtocol {

  constructor(host, options = {}) {
    super(host, options);

    if (typeof host !== 'string' || host === '') {
      throw new Error('host is required');
    }

    // Application-side HTTP route overrides:
    if (options.http && options.http.customRoutes) {
      for (const controller in options.http.customRoutes) {
        if (options.http.customRoutes.hasOwnProperty(controller)) {
          this.http.routes[controller] = Object.assign(this.http.routes[controller] || {}, options.http.customRoutes[controller]);
        }
      }
    }
  }

  get http () {
    return _routes;
  }

  get protocol () {
    return this.ssl ? 'https' : 'http';
  }

  /**
   * Connect to the websocket server
   */
  connect () {
    if (this.state === 'ready') {
      return Promise.resolve();
    }

    return this._sendHttpRequest('GET', '/')
      .then(() => {
        // Client is ready
        this.clientConnected();
      })
      .catch(err => {
        const connectionError = new Error(`Unable to connect to kuzzle server at ${this.host}:${this.port}`);
        connectionError.internal = err;

        this.emit('networkError', connectionError);
        throw err;
      });
  }

  /**
   * Sends a payload to the connected server
   *
   * @param {Object} data
   * @returns {Promise<any>}
   */
  send (data) {
    const
      payload = {
        action: undefined,
        body: undefined,
        collection: undefined,
        controller: undefined,
        headers: {
          'Content-Type': 'application/json'
        },
        index: undefined,
        meta: undefined,
        requestId: undefined,
      },
      queryArgs = {};

    for (const key of Object.keys(data)) {
      const value = data[key];

      if (key === 'body') {
        payload.body = JSON.stringify(value);
      }
      else if (key === 'jwt') {
        payload.headers.authorization = 'Bearer ' + value;
      }
      else if (key === 'volatile') {
        payload.headers['x-kuzzle-volatile'] = JSON.stringify(value);
      }
      else if (payload.hasOwnProperty(key)) {
        payload[key] = value;
      }
      else if (value !== undefined && value !== null) {
        queryArgs[key] = value;
      }
    }

    const
      route = this.http.routes[payload.controller] && this.http.routes[payload.controller][payload.action];

    if (route === undefined) {
      const error = new Error(`No route found for ${payload.controller}/${payload.action}`);
      this.emit(payload.requestId, {status: 400, error});
    }

    const
      method = route.verb,
      regex = /\/:([^/]*)/;

    let
      url = route.url,
      matches = regex.exec(url);

    while (matches) {
      url = url.replace(regex, '/' + data[ matches[1] ]);
      delete(queryArgs[ matches[1] ]);
      matches = regex.exec(url);
    }

    // inject queryString arguments:
    const queryString = [];
    for (const key of Object.keys(queryArgs)) {
      const value = queryArgs[key];

      if (Array.isArray(value)) {
        queryString.push(...value.map(v => `${key}=${v}`));

      }
      else {
        queryString.push(`${key}=${value}`);
      }
    }

    if (queryString.length > 0) {
      url += '?' + queryString.join('&');
    }

    this._sendHttpRequest(method, url, payload)
      .then(response => this.emit(payload.requestId, response))
      .catch(error => this.emit(payload.requestId, {error}));
  }

  _sendHttpRequest (method, path, payload = {}) {
    if (typeof XMLHttpRequest === 'undefined') {
      // NodeJS implementation, using http.request:

      const httpClient = require('min-req-promise');

      if (path[0] !== '/') {
        path = `/${path}`;
      }
      const url = `${this.protocol}://${this.host}:${this.port}${path}`;

      const headers = payload.headers || {};
      headers['Content-Length'] = Buffer.byteLength(payload.body || '');

      return httpClient.request(url, method, {
        headers,
        body: payload.body
      })
        .then(response => JSON.parse(response.body));
    }

    // Browser implementation, using XMLHttpRequest:
    return new Promise((resolve, reject) => {
      const
        xhr = new XMLHttpRequest(),
        url = `${this.protocol}://${this.host}:${this.port}${path}`;

      xhr.open(method, url);

      for (const header of Object.keys(payload.headers || {})) {
        xhr.setRequestHeader(header, payload.headers[header]);
      }

      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json);
        }
        catch (err) {
          reject(err);
        }
      };

      xhr.send(payload.body);
    });
  }

}

module.exports = HttpWrapper;
