import { describe, it, expect } from '@ohos/hypium';
import { FileSelectionPlan, MediaKind, planFileSelection } from '../main/ets/FileSelectionPlanner';

export default function fileSelectionPlannerTest(): void {
  describe('FileSelectionPlanner', () => {
    it('routes image-only requests to the media picker', 0, () => {
      const plan: FileSelectionPlan = planFileSelection(['.png', '.jpg'], ['image/*'], false);
      expect(plan.useMediaPicker).assertTrue();
      expect(plan.mediaKind).assertEqual(MediaKind.Image);
      expect(plan.maxSelectNumber).assertEqual(1);
    });

    it('routes mixed image and video requests to the media picker', 0, () => {
      const plan: FileSelectionPlan =
        planFileSelection(['.png', '.mp4'], ['image/*', 'video/*'], true);
      expect(plan.useMediaPicker).assertTrue();
      expect(plan.mediaKind).assertEqual(MediaKind.ImageAndVideo);
      expect(plan.maxSelectNumber).assertEqual(0);
    });

    it('classifies extension-only accepts as media', 0, () => {
      const plan: FileSelectionPlan = planFileSelection(['.webm'], ['.webm'], false);
      expect(plan.useMediaPicker).assertTrue();
      expect(plan.mediaKind).assertEqual(MediaKind.Video);
    });

    it('splits extensions packed into a single accept entry', 0, () => {
      const plan: FileSelectionPlan =
        planFileSelection(['.mp4, .m4v', '.png'], ['video/mp4', '.png'], false);
      expect(plan.useMediaPicker).assertTrue();
      expect(plan.mediaKind).assertEqual(MediaKind.ImageAndVideo);
    });

    it('routes document requests to the document picker with suffix filters', 0, () => {
      const plan: FileSelectionPlan = planFileSelection(
        ['.json', '.png', '.charx'], ['.json', 'image/png', '.charx'], false);
      expect(plan.useMediaPicker).assertFalse();
      expect(plan.mediaKind).assertEqual(MediaKind.None);
      expect(plan.fileSuffixFilters.length).assertEqual(1);
      expect(plan.fileSuffixFilters[0]).assertEqual('.json,.png,.charx');
    });

    it('leaves the document picker unfiltered when accept is absent', 0, () => {
      const plan: FileSelectionPlan = planFileSelection([], [], false);
      expect(plan.useMediaPicker).assertFalse();
      expect(plan.mediaKind).assertEqual(MediaKind.None);
      expect(plan.fileSuffixFilters.length).assertEqual(0);
    });

    it('treats accept-all as an unfiltered document request', 0, () => {
      const plan: FileSelectionPlan = planFileSelection(['*/*'], ['*/*'], false);
      expect(plan.useMediaPicker).assertFalse();
      expect(plan.fileSuffixFilters.length).assertEqual(0);
    });
  });
}
