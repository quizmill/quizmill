import { PackCheckRunner } from '@/pack/CheckRunner';

/**
 * Readiness check — one stratified sitting across the exam's domains,
 * then a result page that says whether to sit the exam or where to
 * study first. The route exists in every build and gates on the ACTIVE
 * pack at render time (the runner shows an empty state when the pack
 * declares no exam goal).
 */
export default function CheckRoute() {
  return <PackCheckRunner />;
}
