/*!
 * Morgan | Connect - logger
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var bytes = require('bytes');

/*!
 * Default log buffer duration.
 */

var defaultBufferDuration = 1000;

/**
 * Log requests with the given `options` or a `format` string.
 *
 * See README.md for documentation of options and formatting.
 *
 * @param {String|Function|Object} format or options
 * @return {Function} middleware
 * @api public
 */

exports = module.exports = function logger(options) {
  if ('object' == typeof options) {
    options = options || {};
  } else if (options) {
    options = { format: options };
  } else {
    options = {};
  }

  // output on request instead of response
  var immediate = options.immediate;

  // check if log entry should be skipped
  var skip = options.skip || function () { return false; };

  // format name
  var fmt = exports[options.format] || options.format || exports.default;

  // compile format
  if ('function' != typeof fmt) fmt = compile(fmt);

  // options
  var stream = options.stream || process.stdout
    , buffer = options.buffer;

  // buffering support
  if (buffer) {
    var realStream = stream
      , buf = []
      , interval = 'number' == typeof buffer
        ? buffer
        : defaultBufferDuration;

    // flush interval
    setInterval(function(){
      if (buf.length) {
        realStream.write(buf.join(''));
        buf.length = 0;
      }
    }, interval);

    // swap the stream
    stream = {
      write: function(str){
        buf.push(str);
      }
    };
  }

  return function logger(req, res, next) {
    var sock = req.socket
      , end = res.end;
    req._startTime = new Date;
    req._remoteAddress = sock.socket ? sock.socket.remoteAddress : sock.remoteAddress;

    function logRequest(){
      res.removeListener('finish', logRequest);
      res.removeListener('close', logRequest);
      if (skip(req, res)) return;
      var line = fmt(exports, req, res);
      if (null == line) return;
      stream.write(line + '\n');
    };

    // immediate
    if (immediate) {
      logRequest();
    // proxy end to output logging
    } else {
      res.on('finish', logRequest);
      res.on('close', logRequest);
    }

    // Proxy the real end function
    res.end = function(chunk, encoding) {
      res._body = chunk;

      res.end = end;
      res.end(chunk, encoding);
    };

    next();
  };
};

/**
 * Compile `fmt` into a function.
 *
 * @param {String} fmt
 * @return {Function}
 * @api private
 */

function compile(fmt) {
  fmt = fmt.replace(/"/g, '\\"');
  var js = '  return "' + fmt.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, function(_, name, arg){
    return '"\n    + (tokens["' + name + '"](req, res, "' + arg + '") || "-") + "';
  }) + '";'
  return new Function('tokens, req, res', js);
};

/**
 * Define a token function with the given `name`,
 * and callback `fn(req, res)`.
 *
 * @param {String} name
 * @param {Function} fn
 * @return {Object} exports for chaining
 * @api public
 */

exports.token = function(name, fn) {
  exports[name] = fn;
  return this;
};

/**
 * Define a `fmt` with the given `name`.
 *
 * @param {String} name
 * @param {String|Function} fmt
 * @return {Object} exports for chaining
 * @api public
 */

exports.format = function(name, fmt){
  exports[name] = fmt;
  return this;
};

/**
 * Default format.
 */

exports.format('default', '{"address": ":remote-addr", "date": ":date", "method": ":method", "url": ":url", "httpVersion": "HTTP/:http-version", "status": ":status", "contentLength": ":res[content-length]", "referrer": ":referrer", "userAgent": ":user-agent"}');

/**
 * Short format.
 */

exports.format('short', '{"address": ":remote-addr", "method": ":method", "url": ":url", "httpVersion": "HTTP/:http-version", "status": ":status", "contentLength": ":res[content-length]", "time": ":response-time ms", "payload": ":payload", "response": ":res-body"}');

/**
 * Tiny format.
 */

exports.format('tiny', '{"method": ":method", "url": ":url", "status", ":status", "contentLength": ":res[content-length]", "time", ":response-time ms"}');

/**
 * dev (colored)
 */

exports.format('dev', function(tokens, req, res){
  var status = res.statusCode
    , len = parseInt(res.getHeader('Content-Length'), 10)
    , color = 32;

  if (status >= 500) color = 31
  else if (status >= 400) color = 33
  else if (status >= 300) color = 36;

  len = isNaN(len)
    ? ''
    : len = ' - ' + bytes(len);

  return '\x1b[90m' + req.method
    + ' ' + (req.originalUrl || req.url) + ' '
    + '\x1b[' + color + 'm' + res.statusCode
    + ' \x1b[90m'
    + (new Date - req._startTime)
    + 'ms' + len
    + '\x1b[0m';
});

/**
 * request url
 */

exports.token('url', function(req){
  return req.originalUrl || req.url;
});

/**
 * request method
 */

exports.token('method', function(req){
  return req.method;
});

/**
 * response time in milliseconds
 */

exports.token('response-time', function(req){
  return String(Date.now() - req._startTime);
});

/**
 * UTC date
 */

exports.token('date', function(){
  return new Date().toUTCString();
});

/**
 * response status code
 */

exports.token('status', function(req, res){
  return res.headersSent ? res.statusCode : null;
});

/**
 * normalized referrer
 */

exports.token('referrer', function(req){
  return req.headers['referer'] || req.headers['referrer'];
});

/**
 * remote address
 */

exports.token('remote-addr', function(req){
  if (req.ip) return req.ip;
  if (req._remoteAddress) return req._remoteAddress;
  var sock = req.socket;
  if (sock.socket) return sock.socket.remoteAddress;
  return sock.remoteAddress;
});

/**
 * HTTP version
 */

exports.token('http-version', function(req){
  return req.httpVersionMajor + '.' + req.httpVersionMinor;
});

/**
 * UA string
 */

exports.token('user-agent', function(req){
  return req.headers['user-agent'];
});

/**
 * request header
 */

exports.token('req', function(req, res, field){
  return req.headers[field.toLowerCase()];
});

/**
 * response header
 */

exports.token('res', function(req, res, field){
  return (res._headers || {})[field.toLowerCase()];
});

/**
 * payload / request body
 */

exports.token('payload', function(req, res, field){
  return (JSON.stringify(req.body) || '');
});
/**
 * response body
 */

exports.token('res-body', function(req, res, field){
  return (escape(res._body) || '');
});
