import { describe, it, expect } from '@ohos/hypium';
import { assembleEntryParams } from '../main/ets/BackendEntryParams';

export default function backendEntryParamsTest(): void {
  describe('BackendEntryParams', () => {
    it('carries the host pid so the capture client can name the devtools socket', 0, () => {
      const params: string = assembleEntryParams('/data/x', '/bootstrap.js', 8000, 4321);
      expect(params.includes('LUKER_HOST_PID=4321')).assertTrue();
    });

    it('keeps the keys the native launcher already parses', 0, () => {
      const params: string = assembleEntryParams('/data/x', '/bootstrap.js', 8000, 4321);
      expect(params.includes('dataDir=/data/x')).assertTrue();
      expect(params.includes('script=/bootstrap.js')).assertTrue();
      expect(params.includes('port=8000')).assertTrue();
    });

    it('separates every parameter with a newline', 0, () => {
      const params: string = assembleEntryParams('/data/x', '/bootstrap.js', 8000, 4321);
      expect(params.split('\n').length).assertEqual(4);
    });
  });
}
