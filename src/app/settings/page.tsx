import { SettingsPage } from '@/components/SettingsPage';
import { DownvoteBrowser } from '@/pack/DownvoteBrowser';

export default function SettingsRoute() {
  return <SettingsPage extras={<DownvoteBrowser />} />;
}
