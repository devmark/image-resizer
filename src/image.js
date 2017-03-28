'use strict';

const _ = require('lodash');
const Logger = require('./utils/logger');
const env = require('./config/environment_vars');
const modifiers = require('./lib/modifiers');
const stream = require('stream');
const util = require('util');
const imageType = require('image-type');


// Simple stream to represent an error at an early stage, for instance a
// request to an excluded source.
function ErrorStream(image) {
  stream.Readable.call(this, {objectMode: true});
  this.image = image;
}
util.inherits(ErrorStream, stream.Readable);

ErrorStream.prototype._read = function () {
  this.push(this.image);
  this.push(null);
};

class Image {

  constructor(path) {
    this.validInputFormats = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'tif', 'gif'];
    this.validOutputFormats = ['jpeg', 'png', 'webp'];

    // placeholder for any error objects
    this.error = null;

    // set a mark for the start of the process
    this.mark = Date.now();

    // determine the name and format (mime) of the requested image
    this.parseImage(path);

    // determine the requested modifications
    this.modifiers = modifiers.parse(path);

    // pull the various parts needed from the request params
    this.parseUrl({path: path});

    // placeholder for the buffer/stream coming from s3, will hold the image
    this.contents = null;

    // placeholder for the size of the original image
    this.originalContentLength = 0;

    // set the default expiry length, can be altered by a source file
    this.expiry = env.IMAGE_EXPIRY;

    // all logging strings will be queued here to be written on response
    this.log = new Logger();
  }


  // Determine the name and format of the requested image
  parseImage(path) {
    var fileStr = _.last(path.split('/'));
    var exts = fileStr.split('.').map(function (item) {
      return item.toLowerCase();
    });

    // clean out any metadata format
    if (exts[exts.length - 1] === 'json') {
      this.format = exts[exts.length - 2];
      exts.pop();
      fileStr = exts.join('.');
    }

    // if path contains valid output format, remove it from path
    if (exts.length >= 3) {
      var inputFormat = exts[exts.length - 2];
      var outputFormat = exts.pop();

      if (_.indexOf(this.validInputFormats, inputFormat) > -1 &&
        _.indexOf(this.validOutputFormats, outputFormat) > -1) {
        this.outputFormat = outputFormat;
        fileStr = exts.join('.');
      }
    }

    this.image = fileStr;
  };

  // Determine the file path for the requested image
  parseUrl(request) {
    var parts = request.path.replace(/^\//, '').split('/');

    // overwrite the image name with the parsed version so metadata requests do
    // not mess things up
    parts[parts.length - 1] = this.image;

    // if there is a modifier string remove it
    if (this.modifiers.hasModStr) {
      parts.shift();
    }

    this.path = parts.join('/');

    // account for any spaces in the path
    this.path = decodeURI(this.path);
  };


  isError() {
    return this.error !== null;
  };

  isStream() {
    var Stream = require('stream').Stream;
    return !!this.contents && this.contents instanceof Stream;
  };

  isBuffer() {
    return !!this.contents && Buffer.isBuffer(this.contents);
  };

  getFile() {
    var sources = require('./streams/sources'),
      excludes = env.EXCLUDE_SOURCES ? env.EXCLUDE_SOURCES.split(',') : [],
      streamType = env.DEFAULT_SOURCE,
      Stream = null;

    // look to see if the request has a specified source
    if (_.has(this.modifiers, 'external')) {
      if (_.has(sources, this.modifiers.external)) {
        streamType = this.modifiers.external;
      } else if (_.has(env.externalSources, this.modifiers.external)) {
        Stream = sources.external;
        return new Stream(this, this.modifiers.external, env.externalSources[this.modifiers.external]);
      }
    }

    // if this request is for an excluded source create an ErrorStream
    if (excludes.indexOf(streamType) > -1) {
      this.error = new Error(streamType + ' is an excluded source');
      Stream = ErrorStream;
    }

    // if all is well find the appropriate stream
    else {
      Stream = sources[streamType];
    }

    return new Stream(this);
  };

  sizeReduction() {
    var size = this.contents.length;
    return (this.originalContentLength - size) / 1000;
  };

  sizeSaving() {
    var oCnt = this.originalContentLength,
      size = this.contents.length;
    return ((oCnt - size) / oCnt * 100).toFixed(2);
  };

  isFormatValid() {
    if (!this.format) {
      this.error = new Error('Input format not recognized');

      return;
    }

    if (this.validInputFormats.indexOf(this.format) === -1) {
      this.error = new Error('Unsupported input format "' + this.format + '"');
    } else if (this.validOutputFormats.indexOf(this.format) === -1 && !this.outputFormat) {
      this.error = new Error('Unsupported output format "' + this.format + '"');
    }
  };

  get format() {
    return this._format;
  }

  set format(value) {
    this._format = value.toLowerCase();
    if (this._format === 'jpg') {
      this._format = 'jpeg';
    }
    else if (this._format === 'tif') {
      this._format = 'tiff';
    }
  }

  get contents() {
    return this._contents;
  }

  set contents(data) {
    var imgType;

    this._contents = data;

    if (this.isBuffer()) {
      imgType = imageType(data);
      if (imgType) {
        this.format = imgType.ext;
      }
      this.isFormatValid();
    }
  }
}

// // Setter/getter for image format that normalizes formats
// Object.defineProperty(this.prototype, 'format', {
//   get: function () {
//     return this._format;
//   },
//   set: function (value) {
//     this._format = value.toLowerCase();
//     if (this._format === 'jpg') {
//       this._format = 'jpeg';
//     }
//     else if (this._format === 'tif') {
//       this._format = 'tiff';
//     }
//   }
// });

// Setter/getter for image contents that determines the format from the content
// of the image to be processed.
// Object.defineProperty(this.prototype, 'contents', {
//   get: function () {
//     return this._contents;
//   },
//   set: function (data) {
//     var imgType;
//
//     this._contents = data;
//
//     if (this.isBuffer()) {
//       imgType = imageType(data);
//       if (imgType) {
//         this.format = imgType.ext;
//       }
//       this.isFormatValid();
//     }
//   }
// });

module.exports = Image;
