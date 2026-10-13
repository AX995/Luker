import crashSummaryTest from './CrashSummary.test';
import fileSelectionPlannerTest from './FileSelectionPlanner.test';

export default function testsuite(): void {
  crashSummaryTest();
  fileSelectionPlannerTest();
}
