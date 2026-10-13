import { PackExamRunner } from '@/pack/ExamRunner';

/**
 * Timed exam — one sitting at the pack's declared exam pace. The route
 * exists in every build and gates on the ACTIVE pack at render time (the
 * runner shows an empty state when the pack declares no exam length).
 */
export default function ExamRoute() {
  return <PackExamRunner />;
}
