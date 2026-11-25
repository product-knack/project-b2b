import { STAFF_REFERRAL_FLOW_ON } from './staffReferral';

/**
 * Whether the new referral screens are shown in the app (24 Nov 2026). The web has the same file.
 *
 * In a build people install, the release switch alone decides (STAFF_REFERRAL_FLOW_ON, ON since 25 Nov 2026,
 * the owner: "release it"; it reaches people with the next build). On a development run (Expo, with the code
 * on the owner's computer) they are shown whatever the switch says. Nothing else reads this: the admin's
 * approval list and the incentive counts keep to the release switch itself.
 *
 * NOT behind this switch, as on the web: the Hot lead tag, the flash card and the Referred / Duplicate tag on
 * the Leads screen. They only draw for a lead that carries a staff referral remark.
 */
declare const __DEV__: boolean | undefined;

const onDevRun = (): boolean => {
  try {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
  } catch {
    return false;
  }
};

export const REFERRAL_SCREENS_ON: boolean = STAFF_REFERRAL_FLOW_ON || onDevRun();
