import crashSummaryTest from './CrashSummary.test';
import fileSelectionPlannerTest from './FileSelectionPlanner.test';
import backendEntryParamsTest from './BackendEntryParams.test';
import externalLinkPolicyTest from './ExternalLinkPolicy.test';

export default function testsuite(): void {
  crashSummaryTest();
  fileSelectionPlannerTest();
  backendEntryParamsTest();
  externalLinkPolicyTest();
}
