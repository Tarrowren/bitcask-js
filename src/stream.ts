import { read } from "node:fs";
import { Readable } from "node:stream";

export class NoCloseReadStream extends Readable {
  private _pos = 0;

  constructor(private readonly _fd: number) {
    super();
  }

  _read(size: number): void {
    read(
      this._fd,
      Buffer.allocUnsafeSlow(size),
      0,
      size,
      this._pos,
      (err, bytesRead, buf) => {
        if (err) {
          this.destroy(err);
        } else {
          if (bytesRead > 0) {
            this._pos += bytesRead;
            if (bytesRead !== buf.length) {
              const dst = Buffer.allocUnsafeSlow(bytesRead);
              buf.copy(dst, 0, 0, bytesRead);
              buf = dst;
            }
            this.push(buf);
          } else {
            this.push(null);
          }
        }
      },
    );
  }
}
