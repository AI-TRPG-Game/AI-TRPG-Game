import crypto from 'crypto';

export class StreamEmitter {
  constructor() {
    this.streams = new Map();
  }

  createStream() {
    const id = crypto.randomUUID();
    this.streams.set(id, { listeners: [], buffer: [] });
    return id;
  }

  subscribe(streamId, callback) {
    const stream = this.streams.get(streamId);
    if (!stream) {
      this.streams.set(streamId, { listeners: [callback], buffer: [] });
      return () => {};
    }

    for (const event of stream.buffer) {
      callback(event);
    }
    stream.buffer = [];
    stream.listeners.push(callback);

    return () => {
      const idx = stream.listeners.indexOf(callback);
      if (idx >= 0) stream.listeners.splice(idx, 1);
    };
  }

  emit(streamId, event) {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    if (stream.listeners.length === 0) {
      stream.buffer.push(event);
      return;
    }

    for (const listener of stream.listeners) {
      listener(event);
    }
  }

  close(streamId) {
    this.streams.delete(streamId);
  }
}

export const streamEmitter = new StreamEmitter();
