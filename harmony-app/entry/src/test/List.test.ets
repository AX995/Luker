import crashSummaryTest from './CrashSummary.test';
import fileSelectionPlannerTest from './FileSelectionPlanner.test';
import backendEntryParamsTest from './BackendEntryParams.test';

export default function testsuite(): void {
  crashSummaryTest();
  fileSelectionPlannerTest();
  backendEntryParamsTest();
}
