/* ============ QHP Standardized Assessment — native multistep form ============
   Faithful port of the web StandardizedAssessmentForm (Start Now flow):
   - Coach Presence Check first (supporting_trainer_id), then the wizard.
   - Steps: Client Profile → Goal → Medical History → Lifestyle → Tests (goal-
     dependent: standard / prenatal / postpartum / senior) → Psych (existing only).
   - Save contract (web-verbatim): UPDATE coach_assessment by id; JSON goes to
     qhp_data for the three new goal types, else new_client_assessment_data,
     wrapped under "Standardized Assessment"; plus notes/assessment_date/
     location/client_name/completed columns.
   - Prior-QHP prefill for existing clients (steps 1-4+6 only, never tests) and
     "Previous: …" placeholders, like the web.
   Deltas vs web (flagged to the user): no photo/document uploads, no PDF
   generation, no local drafts/offline queue. */
import React from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { supabase } from '../lib/supabase';

/* ---------- shared helpers ---------- */
type FD = Record<string, any>;
const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const s = (v: any) => (v === null || v === undefined ? '' : String(v));
const arr = (v: any): string[] => (Array.isArray(v) ? v : []);
const b = (v: any) => v === true;

function sleepDuration(bedtime: string, wakeTime: string): string {
  if (!bedtime || !wakeTime) return '';
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  if ([bh, bm, wh, wm].some((n) => Number.isNaN(n))) return '';
  let wake = wh * 60 + wm;
  const bed = bh * 60 + bm;
  if (wake <= bed) wake += 24 * 60;
  const d = wake - bed;
  return `${Math.floor(d / 60)}h ${d % 60}m`;
}

/* VO2max formulas (web Vo2MaxMethodCard, verbatim) */
function rockportVo2(weightKg: number, age: number, gender: string, heartRate: number, timeDuration: string): number | null {
  if (!weightKg || !age || !gender || !heartRate || !timeDuration) return null;
  if (heartRate < 60 || heartRate > 220) return null;
  let timeMinutes: number;
  if (timeDuration.includes(':')) {
    const [m, sec] = timeDuration.split(':').map(Number);
    timeMinutes = (m || 0) + (sec || 0) / 60;
  } else timeMinutes = parseFloat(timeDuration);
  if (!timeMinutes || Number.isNaN(timeMinutes)) return null;
  const g = gender === 'male' ? 1 : 0;
  const vo2 = 132.853 - 0.0769 * (weightKg * 2.20462) - 0.3877 * age + 6.315 * g - 3.2649 * timeMinutes - 0.1565 * heartRate;
  return Math.round(vo2 * 10) / 10;
}
function stepperVo2(heartRate: number, gender: string): number | null {
  if (!heartRate || !gender) return null;
  if (heartRate < 60 || heartRate > 220) return null;
  const vo2 = gender === 'male' ? 111.33 - 0.42 * heartRate : 65.81 - 0.1847 * heartRate;
  return Math.round(vo2 * 10) / 10;
}
function cooperVo2(d: number): number | null {
  if (!d || d <= 0) return null;
  return Math.round(Math.max(0, (1000 * d - 504.9) / 44.73) * 10) / 10;
}

const gad7Result = (score: number) => (score <= 4 ? 'Minimal anxiety' : score <= 9 ? 'Mild anxiety' : score <= 14 ? 'Moderate anxiety' : 'Severe anxiety');

/* ---------- default form state (web AssessmentFormData defaults) ---------- */
function initialFd(clientName: string, location: string, assessorName: string): FD {
  const today = new Date().toISOString().split('T')[0];
  return {
    clientName, clientDob: '', clientAge: '', clientGender: '', clientHeight: '', clientWeight: '', clientProfession: '',
    assessorName, assessmentDate: today, location,
    chronicConditions: [], chronicConditionsOther: '', currentMedications: [], currentMedicationsOther: '',
    pastInjuriesUpper: [], pastInjuriesUpperOther: '', pastInjuriesLower: [], pastInjuriesLowerOther: '',
    painDiscomfortAreas: '', surgicalHistory: '',
    pastActivities: [], pastActivitiesOther: '', currentActivities: [], lifestyleType: '', dailyStepCount: '',
    workGetupFrequency: '', habits: [], habitsOther: '', habitFrequencies: {},
    bedtime: '', wakeTime: '', sleepDuration: '', sleepQuality: '', sleepNotes: '', goals: [], goalsNotes: '',
    dietaryPreferences: [], dietaryNotes: '', foodIntolerance: [], foodIntoleranceOther: '',
    currentSupplements: [], currentSupplementsOther: '', dietaryRestrictions: [], dietaryRestrictionsOther: '',
    homeostasisSignals: [], appetite: '', digestionIssues: [], digestionIssuesOther: '',
    travelingSocialFrequency: '', lifestyleNotes: '',
    heartMathMHRR: '', heartMathSDNN: '', heartMathRMSSD: '', heartMathNormalizedCoherence: '',
    selectedGoal: '',
    aslrRightLeg: '', aslrLeftLeg: '', apleTestLeftHandOver: '', apleTestRightHandOver: '', sitReachScore: '', overheadSquatScore: '', commonTestsNotes: '',
    wallSit: '', aestheticsTestsNotes: '',
    vo2MaxPerformance: '', vo2MaxMethod: '', vo2MaxHeartRate: '', vo2MaxTimeDuration: '', vo2MaxCooperDistance: '',
    broadJump: '', maxPushupsOneMinute: '', maxBodyweightSquatOneMinute: '', chinUpOneMinute: '', plankMaxOneMinute: '', situpOneMinute: '', performanceTestsNotes: '',
    vo2MaxLongevity: '', rightLegBalanceMax30Sec: '', leftLegBalanceMax30Sec: '', sitToStandScore: '', standToSitScore: '', gripStrengthLongevity: '', longevityTestsNotes: '',
    hyroxVo2Max: '', hyroxVo2MaxMethod: '', hyroxVo2MaxHeartRate: '', hyroxVo2MaxTimeDuration: '', hyroxVo2MaxCooperDistance: '',
    hyroxGripStrength: '', hyroxWallBalls: '', hyroxHandReleasePushups: '', hyroxRowTime1000m: '', hyroxBurpeeBroadJumps: '', hyroxStationaryLungesTime: '', hyroxTestsNotes: '',
    bloodPressure: '', restingHeartRate: '', fastingGlucose: '', postpartumMedicalNotes: '', sixMinuteWalk: '', muscularStrengthTest: '', handGripStrengthKg: '', sitToStand30Sec: '',
    modifiedPlankSec: '', gluteBridge: '', aslrRight: '', aslrLeft: '', draInches: '', singleLegBalanceRightSec: '', singleLegBalanceLeftSec: '', postpartumTestsNotes: '',
    prenatalBloodPressure: '', prenatalRestingHeartRate: '', prenatalFastingGlucose: '', prenatalMedicalNotes: '', prenatalSixMinuteWalk: '', prenatalMuscularStrengthTest: '',
    prenatalHandGripStrengthKg: '', prenatalSitToStand30Sec: '', prenatalModifiedPlankSec: '', prenatalGluteBridge: '', prenatalAslrRight: '', prenatalAslrLeft: '',
    flexibilitySitReach: '', overheadSquat: '', apleyZipperRight: '', apleyZipperLeft: '', prenatalTestsNotes: '',
    chairStand30Sec: '', armCurlMale8lbs: '', armCurlFemale5lbs: '', twoMinuteStepTest: '', chairSitAndReach: '', backScratchTest: '', eightFootUpAndGoSec: '', seniorTestsNotes: '',
    gad_7_score: undefined, gad_7_result: undefined,
    waistNarrow: '', waistWide: '', hip: '', chest: '', midArmRight: '', midArmLeft: '', midThighRight: '', midThighLeft: '', patellaDistanceRight: '', patellaDistanceLeft: '',
    anteriorPelvicTilt: false, upperCrossSyndrome: false, lowerCrossSyndrome: false, forwardHeadPosture: false, roundedShoulders: false, kyphosis: false, lordosis: false, scoliosis: false,
    posturalOther: false, posturalOtherNotes: '', posturalNotes: '',
    strengthRecommendations: '', cardioRecommendations: '', mobilityRecommendations: '', lifestyleRecommendations: '', recommendationsNotes: '',
    readinessToChange: '', stageOfChange: '', perceivedBarrierToChange: '', perceivedEffortToChange: '', overallStress: '', additionalNotes: '',
  };
}

/* ---------- hydrate a saved row back into (partial) form state (web hydrateFromAssessment) ---------- */
function hydrateFromRow(row: any): Partial<FD> {
  if (!row) return {};
  const unwrap = (src: any) => (src && typeof src === 'object' ? src['Standardized Assessment'] ?? src : null);
  const root = unwrap(row.qhp_data) || unwrap(row.new_client_assessment_data) || unwrap(row.existing_client_assessment_data);
  if (!root || typeof root !== 'object') return {};
  const basic = root.clientProfile?.basicInfo ?? {};
  const med = root.medicalHistory ?? {};
  const life = root.lifestyleActivity ?? {};
  const sleep = life.sleep ?? {};
  const heart = root.heartMathReport ?? {};
  const tests = root.assessmentTests ?? {};
  const common = tests.commonTests ?? {};
  const gbt = tests.goalBasedTests ?? {};
  const body = tests.bodyMeasurements ?? {};
  const pos = tests.posturalAssessment ?? {};
  const recs = tests.recommendations ?? {};
  const psych = root.psychologicalAssessment ?? {};
  const pp = tests.postpartum ?? {};
  const pre = tests.prenatal ?? {};
  const sc = tests.seniorCitizen ?? {};
  const out: Partial<FD> = {
    clientName: s(basic.clientName || row.client_name), clientDob: s(basic.clientDob), clientAge: s(basic.clientAge),
    clientGender: s(basic.clientGender), clientHeight: s(basic.clientHeight), clientWeight: s(basic.clientWeight),
    clientProfession: s(basic.clientProfession), assessorName: s(basic.assessorName),
    chronicConditions: arr(med.chronicConditions), chronicConditionsOther: s(med.chronicConditionsOther),
    currentMedications: arr(med.currentMedications), currentMedicationsOther: s(med.currentMedicationsOther),
    pastInjuriesUpper: arr(med.pastInjuriesUpper), pastInjuriesUpperOther: s(med.pastInjuriesUpperOther),
    pastInjuriesLower: arr(med.pastInjuriesLower), pastInjuriesLowerOther: s(med.pastInjuriesLowerOther),
    painDiscomfortAreas: s(med.painDiscomfortAreas), surgicalHistory: s(med.surgicalHistory),
    pastActivities: arr(life.pastActivities), pastActivitiesOther: s(life.pastActivitiesOther),
    currentActivities: arr(life.currentActivities), lifestyleType: s(life.lifestyleType), dailyStepCount: s(life.dailyStepCount),
    workGetupFrequency: s(life.workGetupFrequency), habits: arr(life.habits), habitsOther: s(life.habitsOther),
    habitFrequencies: life.habitFrequencies && typeof life.habitFrequencies === 'object' ? life.habitFrequencies : {},
    bedtime: s(sleep.bedtime), wakeTime: s(sleep.wakeTime), sleepDuration: s(sleep.sleepDuration), sleepQuality: s(sleep.sleepQuality), sleepNotes: s(sleep.sleepNotes),
    goals: arr(life.goals), goalsNotes: s(life.goalsNotes),
    dietaryPreferences: arr(life.dietaryPreferences), dietaryNotes: s(life.dietaryNotes),
    foodIntolerance: arr(life.foodIntolerance), foodIntoleranceOther: s(life.foodIntoleranceOther),
    currentSupplements: arr(life.currentSupplements), currentSupplementsOther: s(life.currentSupplementsOther),
    dietaryRestrictions: arr(life.dietaryRestrictions), dietaryRestrictionsOther: s(life.dietaryRestrictionsOther),
    homeostasisSignals: arr(life.homeostasisSignals), appetite: s(life.appetite),
    digestionIssues: arr(life.digestionIssues), digestionIssuesOther: s(life.digestionIssuesOther),
    travelingSocialFrequency: s(life.travelingSocialFrequency), lifestyleNotes: s(life.lifestyleNotes),
    heartMathMHRR: s(heart.MHRR), heartMathSDNN: s(heart.SDNN), heartMathRMSSD: s(heart.RMSSD), heartMathNormalizedCoherence: s(heart.normalizedCoherence),
    selectedGoal: s(root.selectedGoal),
    aslrRightLeg: s(common.aslrRightLeg), aslrLeftLeg: s(common.aslrLeftLeg), apleTestLeftHandOver: s(common.apleTestLeftHandOver),
    apleTestRightHandOver: s(common.apleTestRightHandOver), sitReachScore: s(common.sitReachScore), overheadSquatScore: s(common.overheadSquatScore), commonTestsNotes: s(common.commonTestsNotes),
    wallSit: s(gbt.aesthetics?.wallSit), aestheticsTestsNotes: s(gbt.aesthetics?.aestheticsTestsNotes),
    vo2MaxPerformance: s(gbt.aesthetics?.vo2MaxPerformance ?? gbt.performance?.vo2MaxPerformance),
    broadJump: s(gbt.performance?.broadJump), maxPushupsOneMinute: s(gbt.performance?.maxPushupsOneMinute),
    maxBodyweightSquatOneMinute: s(gbt.performance?.maxBodyweightSquatOneMinute), chinUpOneMinute: s(gbt.performance?.chinUpOneMinute),
    plankMaxOneMinute: s(gbt.performance?.plankMaxOneMinute), situpOneMinute: s(gbt.performance?.situpOneMinute), performanceTestsNotes: s(gbt.performance?.performanceTestsNotes),
    vo2MaxLongevity: s(gbt.longevity?.vo2MaxLongevity), rightLegBalanceMax30Sec: s(gbt.longevity?.rightLegBalanceMax30Sec), leftLegBalanceMax30Sec: s(gbt.longevity?.leftLegBalanceMax30Sec),
    sitToStandScore: s(gbt.aesthetics?.sitToStandScore ?? gbt.longevity?.sitToStandScore), standToSitScore: s(gbt.aesthetics?.standToSitScore ?? gbt.longevity?.standToSitScore),
    gripStrengthLongevity: s(gbt.aesthetics?.gripStrengthLongevity ?? gbt.longevity?.gripStrengthLongevity), longevityTestsNotes: s(gbt.longevity?.longevityTestsNotes),
    hyroxVo2Max: s(gbt.hyrox?.hyroxVo2Max), hyroxGripStrength: s(gbt.hyrox?.hyroxGripStrength), hyroxWallBalls: s(gbt.hyrox?.hyroxWallBalls),
    hyroxHandReleasePushups: s(gbt.hyrox?.hyroxHandReleasePushups), hyroxRowTime1000m: s(gbt.hyrox?.hyroxRowTime1000m),
    hyroxBurpeeBroadJumps: s(gbt.hyrox?.hyroxBurpeeBroadJumps), hyroxStationaryLungesTime: s(gbt.hyrox?.hyroxStationaryLungesTime), hyroxTestsNotes: s(gbt.hyrox?.hyroxTestsNotes),
    bloodPressure: s(pp.medicalVitalScreening?.bloodPressure), restingHeartRate: s(pp.medicalVitalScreening?.restingHeartRate),
    fastingGlucose: s(pp.medicalVitalScreening?.fastingGlucose), postpartumMedicalNotes: s(pp.medicalVitalScreening?.notes),
    sixMinuteWalk: s(pp.cardiovascularEndurance?.sixMinuteWalk), muscularStrengthTest: s(pp.cardiovascularEndurance?.muscularStrengthTest),
    handGripStrengthKg: s(pp.cardiovascularEndurance?.handGripStrengthKg), sitToStand30Sec: s(pp.cardiovascularEndurance?.sitToStand30Sec),
    modifiedPlankSec: s(pp.corePelvicStability?.modifiedPlankSec), gluteBridge: s(pp.corePelvicStability?.gluteBridge),
    aslrRight: s(pp.corePelvicStability?.aslrRight), aslrLeft: s(pp.corePelvicStability?.aslrLeft),
    draInches: s(pp.diastasisRectiAbdominis?.draInches),
    singleLegBalanceRightSec: s(pp.balance?.singleLegBalanceRightSec), singleLegBalanceLeftSec: s(pp.balance?.singleLegBalanceLeftSec), postpartumTestsNotes: s(pp.notes),
    prenatalBloodPressure: s(pre.medicalVitalScreening?.bloodPressure), prenatalRestingHeartRate: s(pre.medicalVitalScreening?.restingHeartRate),
    prenatalFastingGlucose: s(pre.medicalVitalScreening?.fastingGlucose), prenatalMedicalNotes: s(pre.medicalVitalScreening?.notes),
    prenatalSixMinuteWalk: s(pre.cardiovascularEndurance?.sixMinuteWalk), prenatalMuscularStrengthTest: s(pre.cardiovascularEndurance?.muscularStrengthTest),
    prenatalHandGripStrengthKg: s(pre.cardiovascularEndurance?.handGripStrengthKg), prenatalSitToStand30Sec: s(pre.cardiovascularEndurance?.sitToStand30Sec),
    prenatalModifiedPlankSec: s(pre.corePelvicStabilityMobility?.modifiedPlankSec), prenatalGluteBridge: s(pre.corePelvicStabilityMobility?.gluteBridge),
    prenatalAslrRight: s(pre.corePelvicStabilityMobility?.aslrRight), prenatalAslrLeft: s(pre.corePelvicStabilityMobility?.aslrLeft),
    flexibilitySitReach: s(pre.corePelvicStabilityMobility?.flexibilitySitReach), overheadSquat: s(pre.corePelvicStabilityMobility?.overheadSquat),
    apleyZipperRight: s(pre.corePelvicStabilityMobility?.apleyZipperRight), apleyZipperLeft: s(pre.corePelvicStabilityMobility?.apleyZipperLeft), prenatalTestsNotes: s(pre.notes),
    chairStand30Sec: s(sc.fitnessTests?.chairStand30Sec), armCurlMale8lbs: s(sc.fitnessTests?.armCurlMale8lbs), armCurlFemale5lbs: s(sc.fitnessTests?.armCurlFemale5lbs),
    twoMinuteStepTest: s(sc.fitnessTests?.twoMinuteStepTest), chairSitAndReach: s(sc.fitnessTests?.chairSitAndReach), backScratchTest: s(sc.fitnessTests?.backScratchTest),
    eightFootUpAndGoSec: s(sc.fitnessTests?.eightFootUpAndGoSec), seniorTestsNotes: s(sc.notes),
    waistNarrow: s(body.waistNarrow), waistWide: s(body.waistWide), hip: s(body.hip), chest: s(body.chest),
    midArmRight: s(body.midArmRight), midArmLeft: s(body.midArmLeft), midThighRight: s(body.midThighRight), midThighLeft: s(body.midThighLeft),
    patellaDistanceRight: s(body.patellaDistanceRight), patellaDistanceLeft: s(body.patellaDistanceLeft),
    anteriorPelvicTilt: b(pos.anteriorPelvicTilt), upperCrossSyndrome: b(pos.upperCrossSyndrome), lowerCrossSyndrome: b(pos.lowerCrossSyndrome),
    forwardHeadPosture: b(pos.forwardHeadPosture), roundedShoulders: b(pos.roundedShoulders), kyphosis: b(pos.kyphosis), lordosis: b(pos.lordosis), scoliosis: b(pos.scoliosis),
    posturalOther: b(pos.posturalOther), posturalOtherNotes: s(pos.posturalOtherNotes), posturalNotes: s(pos.posturalNotes),
    strengthRecommendations: s(recs.strengthRecommendations), cardioRecommendations: s(recs.cardioRecommendations),
    mobilityRecommendations: s(recs.mobilityRecommendations), lifestyleRecommendations: s(recs.lifestyleRecommendations), recommendationsNotes: s(recs.recommendationsNotes),
    readinessToChange: s(psych.readinessToChange), stageOfChange: s(psych.stageOfChange), perceivedBarrierToChange: s(psych.perceivedBarrierToChange),
    perceivedEffortToChange: s(psych.perceivedEffortToChange), overallStress: s(psych.overallStress), additionalNotes: s(psych.additionalNotes),
  };
  return out;
}

/* Step-5 keys — never prefilled from the prior QHP (web STEP_5_KEYS). */
const STEP5_KEYS = [
  'aslrRightLeg', 'aslrLeftLeg', 'apleTestLeftHandOver', 'apleTestRightHandOver', 'sitReachScore', 'overheadSquatScore', 'commonTestsNotes',
  'wallSit', 'aestheticsTestsNotes', 'vo2MaxPerformance', 'vo2MaxMethod', 'vo2MaxHeartRate', 'vo2MaxTimeDuration', 'vo2MaxCooperDistance',
  'broadJump', 'maxPushupsOneMinute', 'maxBodyweightSquatOneMinute', 'chinUpOneMinute', 'plankMaxOneMinute', 'situpOneMinute', 'performanceTestsNotes',
  'vo2MaxLongevity', 'rightLegBalanceMax30Sec', 'leftLegBalanceMax30Sec', 'sitToStandScore', 'standToSitScore', 'gripStrengthLongevity', 'longevityTestsNotes',
  'hyroxVo2Max', 'hyroxVo2MaxMethod', 'hyroxVo2MaxHeartRate', 'hyroxVo2MaxTimeDuration', 'hyroxVo2MaxCooperDistance', 'hyroxGripStrength', 'hyroxWallBalls',
  'hyroxHandReleasePushups', 'hyroxRowTime1000m', 'hyroxBurpeeBroadJumps', 'hyroxStationaryLungesTime', 'hyroxTestsNotes',
  'bloodPressure', 'restingHeartRate', 'fastingGlucose', 'postpartumMedicalNotes', 'sixMinuteWalk', 'muscularStrengthTest', 'handGripStrengthKg', 'sitToStand30Sec',
  'modifiedPlankSec', 'gluteBridge', 'aslrRight', 'aslrLeft', 'draInches', 'singleLegBalanceRightSec', 'singleLegBalanceLeftSec', 'postpartumTestsNotes',
  'prenatalBloodPressure', 'prenatalRestingHeartRate', 'prenatalFastingGlucose', 'prenatalMedicalNotes', 'prenatalSixMinuteWalk', 'prenatalMuscularStrengthTest',
  'prenatalHandGripStrengthKg', 'prenatalSitToStand30Sec', 'prenatalModifiedPlankSec', 'prenatalGluteBridge', 'prenatalAslrRight', 'prenatalAslrLeft',
  'flexibilitySitReach', 'overheadSquat', 'apleyZipperRight', 'apleyZipperLeft', 'prenatalTestsNotes',
  'chairStand30Sec', 'armCurlMale8lbs', 'armCurlFemale5lbs', 'twoMinuteStepTest', 'chairSitAndReach', 'backScratchTest', 'eightFootUpAndGoSec', 'seniorTestsNotes',
  'gad_7_score', 'gad_7_result',
  'waistNarrow', 'waistWide', 'hip', 'chest', 'midArmRight', 'midArmLeft', 'midThighRight', 'midThighLeft', 'patellaDistanceRight', 'patellaDistanceLeft',
  'anteriorPelvicTilt', 'upperCrossSyndrome', 'lowerCrossSyndrome', 'forwardHeadPosture', 'roundedShoulders', 'kyphosis', 'lordosis', 'scoliosis',
  'posturalOther', 'posturalOtherNotes', 'posturalNotes',
  'strengthRecommendations', 'cardioRecommendations', 'mobilityRecommendations', 'lifestyleRecommendations', 'recommendationsNotes',
];
const isEmptyVal = (v: any) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/* ---------- prior completed QHP check (web fetchHasPriorCompletedQHP) ---------- */
export async function fetchHasPriorCompletedQHP(clientId: string, excludeAssessmentId?: string): Promise<boolean> {
  let q = supabase
    .from('coach_assessment')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .or('new_client_assessment_data.not.is.null,existing_client_assessment_data.not.is.null,qhp_data.not.is.null');
  if (excludeAssessmentId) q = q.neq('id', excludeAssessmentId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/* ---------- UI primitives (form-local) ---------- */
const IN_BG = 'rgba(255,255,255,0.045)';
const IN_BD = 'rgba(255,255,255,0.1)';
function L({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#C8C2BC', marginBottom: 6 }}>{children}</Text>;
}
function Inp({ v, on, ph: placeholder, multi, num, readOnly }: { v: string; on?: (t: string) => void; ph?: string; multi?: boolean; num?: boolean; readOnly?: boolean }) {
  return (
    <TextInput
      value={v}
      onChangeText={on}
      editable={!readOnly}
      placeholder={placeholder}
      placeholderTextColor="#6B655F"
      multiline={!!multi}
      keyboardType={num ? 'numeric' : 'default'}
      style={{ backgroundColor: readOnly ? 'rgba(255,255,255,0.02)' : IN_BG, borderWidth: 1, borderColor: IN_BD, borderRadius: 12, paddingHorizontal: 12, paddingVertical: multi ? 10 : 9, minHeight: multi ? 72 : undefined, textAlignVertical: multi ? 'top' : 'center', fontFamily: F.body, fontSize: 13, color: readOnly ? C.muted2 : '#fff' }}
    />
  );
}
function Sel({ v, on, options }: { v: string; on: (val: string) => void; options: { v: string; l: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {options.map((o) => {
        const active = v === o.v;
        return (
          <Pressable key={o.v || '_'} onPress={() => on(active ? '' : o.v)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : IN_BG, borderWidth: 1, borderColor: active ? hexA(C.orange, 0.55) : IN_BD }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? C.orange : '#B8B2AC' }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Chks({ items, selected, onToggle, prev }: { items: string[]; selected: string[]; onToggle: (v: string) => void; prev?: string[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {items.map((it) => {
        const on = selected.includes(it);
        const wasPrev = prev?.includes(it);
        return (
          <Pressable key={it} onPress={() => onToggle(it)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: on ? hexA(C.orange, 0.16) : wasPrev ? hexA(C.gold, 0.08) : IN_BG, borderWidth: 1, borderColor: on ? hexA(C.orange, 0.55) : wasPrev ? hexA(C.gold, 0.35) : IN_BD }}>
            {on ? <Icon path="M20 6 9 17l-5-5" size={11} color={C.orange} strokeWidth={2.6} /> : null}
            <Text style={{ fontFamily: on ? F.bodyBold : F.body, fontSize: 11.5, color: on ? C.orange : '#B8B2AC' }}>{it}</Text>
            {wasPrev && !on ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
function Sec({ title, children, tint = C.orange }: { title: string; children: React.ReactNode; tint?: string }) {
  return (
    <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(tint, 0.16), gap: 12 }}>
      <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: tint }}>{title.toUpperCase()}</Mono>
      {children}
    </View>
  );
}
function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}
function Half({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

/* ---------- Coach Presence Check (web SupportingTrainerModal) ---------- */
export function CoachPresenceModal({ visible, meId, onClose, onConfirm, busy }: { visible: boolean; meId: string; onClose: () => void; onConfirm: (supportingTrainerId: string | null) => void; busy?: boolean }) {
  const [hasOther, setHasOther] = React.useState<'yes' | 'no' | null>(null);
  const [selId, setSelId] = React.useState<string>('');
  const trainersQ = useQuery({
    queryKey: ['all-trainers-for-support', meId],
    enabled: visible && hasOther === 'yes',
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').neq('id', meId).order('first_name');
      if (error) throw new Error(error.message);
      return (data ?? []).map((t: any) => ({ id: t.id, name: `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() }));
    },
  });
  const reset = () => { setHasOther(null); setSelId(''); };
  React.useEffect(() => { if (!visible) reset(); }, [visible]);
  const disabled = busy || hasOther === null || (hasOther === 'yes' && !selId);
  const dismiss = () => { if (busy) return; reset(); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 22 }}>
        <Pressable onPress={dismiss} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        <View style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.orange, 0.3), padding: 18, gap: 14, maxHeight: '80%' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Coach Presence Check</Text>
          <Body style={{ fontSize: 12.5, color: C.muted2 }}>Is there any other coach with you?</Body>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            {(['yes', 'no'] as const).map((v) => {
              const on = hasOther === v;
              return (
                <Pressable key={v} onPress={() => { setHasOther(v); if (v === 'no') setSelId(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: on ? hexA(C.orange, 0.16) : IN_BG, borderWidth: 1, borderColor: on ? hexA(C.orange, 0.55) : IN_BD }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: on ? C.orange : C.muted2 }}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                </Pressable>
              );
            })}
          </View>
          {hasOther === 'yes' ? (
            trainersQ.isLoading ? (
              <ActivityIndicator color={C.orange} />
            ) : (
              <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                {(trainersQ.data ?? []).map((t) => {
                  const on = selId === t.id;
                  return (
                    <Pressable key={t.id} onPress={() => setSelId(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11, backgroundColor: on ? hexA(C.orange, 0.12) : 'transparent', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.4) : 'transparent', marginBottom: 3 }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: on ? C.orange : IN_BD, alignItems: 'center', justifyContent: 'center' }}>
                        {on ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange }} /> : null}
                      </View>
                      <Body style={{ fontSize: 13, color: on ? '#fff' : C.muted2 }}>{t.name || 'Trainer'}</Body>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          ) : null}
          <Pressable disabled={disabled} onPress={() => { const id = hasOther === 'yes' ? selId : null; onConfirm(id); }} style={{ borderRadius: 12, overflow: 'hidden', opacity: disabled && !busy ? 0.4 : 1 }}>
            <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
              {busy ? <ActivityIndicator size="small" color="#1A0D05" /> : null}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#1A0D05' }}>{busy ? 'Preparing assessment…' : 'Continue to Assessment'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- GAD-7 sheet ---------- */
const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  "Being so restless that it's hard to sit still",
  'Becoming easily annoyed or irritable',
  'Feeling afraid as if something awful might happen',
];
const GAD7_OPTS = [
  { v: 0, l: 'Not at all' }, { v: 1, l: 'Several days' }, { v: 2, l: 'More than half the days' }, { v: 3, l: 'Nearly every day' },
];
const GAD7_DIFF = [
  { v: 0, l: 'Not difficult at all' }, { v: 1, l: 'Somewhat difficult' }, { v: 2, l: 'Very difficult' }, { v: 3, l: 'Extremely difficult' },
];
function Gad7Sheet({ visible, onClose, onComplete }: { visible: boolean; onClose: () => void; onComplete: (score: number, result: string) => void }) {
  const [answers, setAnswers] = React.useState<Record<number, number>>({});
  const [diff, setDiff] = React.useState<number | null>(null);
  const complete = Object.keys(answers).length === 7;
  const submit = () => {
    let total = 0;
    for (let i = 0; i < 7; i++) total += answers[i] ?? 0;
    if (diff !== null) total += diff; // web quirk: difficulty adds to the total
    onComplete(total, gad7Result(total));
    setAnswers({}); setDiff(null);
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        <View style={{ height: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 20 }}>GAD-7</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, marginTop: 3, marginBottom: 10 }}>Over the last 2 weeks, how often have you been bothered by the following problems?</Body>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, gap: 14 }}>
            {GAD7_QUESTIONS.map((q, i) => (
              <View key={i} style={{ gap: 8 }}>
                <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{i + 1}. {q}</Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {GAD7_OPTS.map((o) => {
                    const on = answers[i] === o.v;
                    return (
                      <Pressable key={o.v} onPress={() => setAnswers((a) => ({ ...a, [i]: o.v }))} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: on ? hexA(C.orange, 0.16) : IN_BG, borderWidth: 1, borderColor: on ? hexA(C.orange, 0.55) : IN_BD }}>
                        <Text style={{ fontFamily: on ? F.bodyBold : F.body, fontSize: 10.5, color: on ? C.orange : '#B8B2AC' }}>{o.l} ({o.v})</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            {complete ? (
              <View style={{ gap: 8 }}>
                <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>If you checked any problems, how difficult have these made it for you (work, home, getting along with people)? <Text style={{ color: C.muted3 }}>(Optional)</Text></Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {GAD7_DIFF.map((o) => {
                    const on = diff === o.v;
                    return (
                      <Pressable key={o.v} onPress={() => setDiff(on ? null : o.v)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: on ? hexA(C.blue, 0.16) : IN_BG, borderWidth: 1, borderColor: on ? hexA(C.blue, 0.55) : IN_BD }}>
                        <Text style={{ fontFamily: on ? F.bodyBold : F.body, fontSize: 10.5, color: on ? C.blue : '#B8B2AC' }}>{o.l} ({o.v})</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <Pressable disabled={!complete} onPress={submit} style={{ borderRadius: 12, overflow: 'hidden', opacity: complete ? 1 : 0.4, marginTop: 4 }}>
              <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#1A0D05' }}>Submit GAD-7</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- VO2 Max method card (web Vo2MaxMethodCard) ---------- */
function Vo2Card({ fd, keys, clientGender, clientAge, clientWeight, onPatch }: {
  fd: FD;
  keys: { method: string; value: string; heartRate: string; timeDuration: string; cooperDistance: string };
  clientGender: string; clientAge: number; clientWeight: number;
  onPatch: (p: Partial<FD>) => void;
}) {
  const method = fd[keys.method] as string;
  const hr = parseFloat(fd[keys.heartRate]) || 0;
  const computed =
    method === 'rockport' ? rockportVo2(clientWeight, clientAge, clientGender, hr, fd[keys.timeDuration]) :
    method === 'stepper' ? stepperVo2(hr, clientGender) :
    method === 'cooper' ? cooperVo2(parseFloat(fd[keys.cooperDistance]) || 0) : null;
  React.useEffect(() => {
    if (computed !== null && String(computed) !== fd[keys.value]) onPatch({ [keys.value]: String(computed) });
  }, [computed]);
  const setMethod = (m: string) => onPatch({ [keys.method]: m, [keys.value]: '', [keys.heartRate]: '', [keys.timeDuration]: '', [keys.cooperDistance]: '' });
  const hrBad = fd[keys.heartRate] !== '' && (hr < 60 || hr > 220);
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: IN_BD }}>
      <L>VO2 Max (ml/kg/min)</L>
      <Sel v={method} on={setMethod} options={[{ v: 'fitness_tracker', l: 'Fitness Tracker' }, { v: 'rockport', l: 'Rockport' }, { v: 'stepper', l: '3 Min Stepper' }, { v: 'cooper', l: 'Cooper Test' }]} />
      {method === 'fitness_tracker' ? (
        <View><L>VO2 Max Value</L><Inp v={fd[keys.value]} on={(t) => onPatch({ [keys.value]: t })} ph="Enter VO2 Max" num /></View>
      ) : null}
      {method === 'rockport' ? (
        <View style={{ gap: 10 }}>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>From Step 1 — Weight: {clientWeight || 'missing'} kg · Age: {clientAge || 'missing'} · Gender: {clientGender || 'missing'}</Body>
          <View><L>Post-Exercise Heart Rate (bpm)</L><Inp v={fd[keys.heartRate]} on={(t) => onPatch({ [keys.heartRate]: t })} ph="60–220 bpm" num /></View>
          <View><L>Time to Complete Walk (mm:ss)</L><Inp v={fd[keys.timeDuration]} on={(t) => onPatch({ [keys.timeDuration]: t })} ph="e.g. 14:30" /></View>
        </View>
      ) : null}
      {method === 'stepper' ? (
        <View><L>Heart Rate after 3 Min Step Test (bpm)</L><Inp v={fd[keys.heartRate]} on={(t) => onPatch({ [keys.heartRate]: t })} ph="60–220 bpm" num /></View>
      ) : null}
      {method === 'cooper' ? (
        <View>
          <L>Distance covered in 12 min (km)</L>
          <Inp v={fd[keys.cooperDistance]} on={(t) => onPatch({ [keys.cooperDistance]: t })} ph="e.g. 2.4" num />
          <Body style={{ fontSize: 10, color: C.muted3, marginTop: 4 }}>Formula: VO₂max = (1000·d − 504.9) / 44.73</Body>
        </View>
      ) : null}
      {hrBad ? <Body style={{ fontSize: 10.5, color: C.red }}>Heart rate must be between 60–220 bpm</Body> : null}
      {computed !== null ? (
        <View style={{ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>VO₂max Result: {computed} ml/kg/min</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- build the saved JSON (web buildAssessmentData / handleSubmit, verbatim keys) ---------- */
function buildAssessmentData(fd: FD, isExistingClient: boolean) {
  const isNewGoalType = ['Postpartum Fitness Test', 'Prenatal Fitness Test', 'Senior Citizen Fitness Test'].includes(fd.selectedGoal);
  const sa: any = {
    clientProfile: {
      basicInfo: {
        clientName: fd.clientName, clientDob: fd.clientDob,
        clientAge: parseInt(fd.clientAge) || 0,
        clientGender: fd.clientGender, clientHeight: fd.clientHeight, clientWeight: fd.clientWeight,
        clientProfession: fd.clientProfession, assessorName: fd.assessorName, assessmentDate: fd.assessmentDate, location: fd.location,
      },
    },
    medicalHistory: {
      chronicConditions: fd.chronicConditions, chronicConditionsOther: fd.chronicConditionsOther,
      currentMedications: fd.currentMedications, currentMedicationsOther: fd.currentMedicationsOther,
      pastInjuriesUpper: fd.pastInjuriesUpper, pastInjuriesUpperOther: fd.pastInjuriesUpperOther,
      pastInjuriesLower: fd.pastInjuriesLower, pastInjuriesLowerOther: fd.pastInjuriesLowerOther,
      painDiscomfortAreas: fd.painDiscomfortAreas, surgicalHistory: fd.surgicalHistory,
    },
    lifestyleActivity: {
      pastActivities: fd.pastActivities, pastActivitiesOther: fd.pastActivitiesOther, currentActivities: fd.currentActivities,
      lifestyleType: fd.lifestyleType, dailyStepCount: fd.dailyStepCount, workGetupFrequency: fd.workGetupFrequency,
      habits: fd.habits, habitsOther: fd.habitsOther, habitFrequencies: fd.habitFrequencies,
      sleep: { bedtime: fd.bedtime, wakeTime: fd.wakeTime, sleepDuration: fd.sleepDuration, sleepQuality: fd.sleepQuality, sleepNotes: fd.sleepNotes },
      goals: fd.goals, goalsNotes: fd.goalsNotes,
      dietaryPreferences: fd.dietaryPreferences, dietaryNotes: fd.dietaryNotes,
      foodIntolerance: fd.foodIntolerance, foodIntoleranceOther: fd.foodIntoleranceOther,
      currentSupplements: fd.currentSupplements, currentSupplementsOther: fd.currentSupplementsOther,
      dietaryRestrictions: fd.dietaryRestrictions, dietaryRestrictionsOther: fd.dietaryRestrictionsOther,
      homeostasisSignals: fd.homeostasisSignals, appetite: fd.appetite,
      digestionIssues: fd.digestionIssues, digestionIssuesOther: fd.digestionIssuesOther,
      travelingSocialFrequency: fd.travelingSocialFrequency, lifestyleNotes: fd.lifestyleNotes,
    },
    heartMathReport: { MHRR: fd.heartMathMHRR, SDNN: fd.heartMathSDNN, RMSSD: fd.heartMathRMSSD, normalizedCoherence: fd.heartMathNormalizedCoherence },
    selectedGoal: fd.selectedGoal,
  };
  if (isNewGoalType) {
    const gad = fd.gad_7_score !== undefined ? { gad_7_score: fd.gad_7_score, gad_7_result: fd.gad_7_result } : {};
    if (fd.selectedGoal === 'Postpartum Fitness Test') {
      sa.assessmentTests = {
        postpartum: {
          medicalVitalScreening: { bloodPressure: fd.bloodPressure, restingHeartRate: fd.restingHeartRate, fastingGlucose: fd.fastingGlucose, notes: fd.postpartumMedicalNotes },
          cardiovascularEndurance: { sixMinuteWalk: fd.sixMinuteWalk, muscularStrengthTest: fd.muscularStrengthTest, handGripStrengthKg: fd.handGripStrengthKg, sitToStand30Sec: fd.sitToStand30Sec },
          corePelvicStability: { modifiedPlankSec: fd.modifiedPlankSec, gluteBridge: fd.gluteBridge, aslrRight: fd.aslrRight, aslrLeft: fd.aslrLeft },
          diastasisRectiAbdominis: { draInches: fd.draInches },
          balance: { singleLegBalanceRightSec: fd.singleLegBalanceRightSec, singleLegBalanceLeftSec: fd.singleLegBalanceLeftSec },
          notes: fd.postpartumTestsNotes,
          ...gad,
        },
      };
    } else if (fd.selectedGoal === 'Prenatal Fitness Test') {
      sa.assessmentTests = {
        prenatal: {
          medicalVitalScreening: { bloodPressure: fd.prenatalBloodPressure, restingHeartRate: fd.prenatalRestingHeartRate, fastingGlucose: fd.prenatalFastingGlucose, notes: fd.prenatalMedicalNotes },
          cardiovascularEndurance: { sixMinuteWalk: fd.prenatalSixMinuteWalk, muscularStrengthTest: fd.prenatalMuscularStrengthTest, handGripStrengthKg: fd.prenatalHandGripStrengthKg, sitToStand30Sec: fd.prenatalSitToStand30Sec },
          corePelvicStabilityMobility: { modifiedPlankSec: fd.prenatalModifiedPlankSec, gluteBridge: fd.prenatalGluteBridge, aslrRight: fd.prenatalAslrRight, aslrLeft: fd.prenatalAslrLeft, flexibilitySitReach: fd.flexibilitySitReach, overheadSquat: fd.overheadSquat, apleyZipperRight: fd.apleyZipperRight, apleyZipperLeft: fd.apleyZipperLeft },
          notes: fd.prenatalTestsNotes,
          ...gad,
        },
      };
    } else {
      sa.assessmentTests = {
        seniorCitizen: {
          fitnessTests: { chairStand30Sec: fd.chairStand30Sec, armCurlMale8lbs: fd.armCurlMale8lbs, armCurlFemale5lbs: fd.armCurlFemale5lbs, twoMinuteStepTest: fd.twoMinuteStepTest, chairSitAndReach: fd.chairSitAndReach, backScratchTest: fd.backScratchTest, eightFootUpAndGoSec: fd.eightFootUpAndGoSec },
          notes: fd.seniorTestsNotes,
        },
      };
    }
  } else {
    sa.assessmentTests = {
      commonTests: { aslrRightLeg: fd.aslrRightLeg, aslrLeftLeg: fd.aslrLeftLeg, apleTestLeftHandOver: fd.apleTestLeftHandOver, apleTestRightHandOver: fd.apleTestRightHandOver, sitReachScore: fd.sitReachScore, overheadSquatScore: fd.overheadSquatScore, commonTestsNotes: fd.commonTestsNotes },
      goalBasedTests: {
        aesthetics: fd.selectedGoal === 'Aesthetics' ? { wallSit: fd.wallSit, aestheticsTestsNotes: fd.aestheticsTestsNotes, aestheticsImageUrl: null, vo2MaxPerformance: fd.vo2MaxPerformance, vo2MaxMethod: fd.vo2MaxMethod, vo2MaxHeartRate: fd.vo2MaxHeartRate, vo2MaxTimeDuration: fd.vo2MaxTimeDuration, vo2MaxCooperDistance: fd.vo2MaxCooperDistance, gripStrengthLongevity: fd.gripStrengthLongevity, sitToStandScore: fd.sitToStandScore, standToSitScore: fd.standToSitScore } : null,
        performance: fd.selectedGoal === 'Performance' ? { vo2MaxPerformance: fd.vo2MaxPerformance, broadJump: fd.broadJump, maxPushupsOneMinute: fd.maxPushupsOneMinute, maxBodyweightSquatOneMinute: fd.maxBodyweightSquatOneMinute, chinUpOneMinute: fd.chinUpOneMinute, plankMaxOneMinute: fd.plankMaxOneMinute, situpOneMinute: fd.situpOneMinute, performanceTestsNotes: fd.performanceTestsNotes } : null,
        longevity: fd.selectedGoal === 'Longevity' ? { vo2MaxLongevity: fd.vo2MaxLongevity, rightLegBalanceMax30Sec: fd.rightLegBalanceMax30Sec, leftLegBalanceMax30Sec: fd.leftLegBalanceMax30Sec, sitToStandScore: fd.sitToStandScore, standToSitScore: fd.standToSitScore, gripStrengthLongevity: fd.gripStrengthLongevity, longevityTestsNotes: fd.longevityTestsNotes } : null,
        hyrox: fd.selectedGoal === 'Hyrox' ? { hyroxVo2Max: fd.hyroxVo2Max, hyroxVo2MaxMethod: fd.hyroxVo2MaxMethod, hyroxVo2MaxHeartRate: fd.hyroxVo2MaxHeartRate, hyroxVo2MaxTimeDuration: fd.hyroxVo2MaxTimeDuration, hyroxVo2MaxCooperDistance: fd.hyroxVo2MaxCooperDistance, hyroxGripStrength: fd.hyroxGripStrength, hyroxWallBalls: fd.hyroxWallBalls, hyroxHandReleasePushups: fd.hyroxHandReleasePushups, hyroxRowTime1000m: fd.hyroxRowTime1000m, hyroxBurpeeBroadJumps: fd.hyroxBurpeeBroadJumps, hyroxStationaryLungesTime: fd.hyroxStationaryLungesTime, hyroxTestsNotes: fd.hyroxTestsNotes } : null,
      },
      bodyMeasurements: { waistNarrow: fd.waistNarrow, waistWide: fd.waistWide, hip: fd.hip, chest: fd.chest, midArmRight: fd.midArmRight, midArmLeft: fd.midArmLeft, midThighRight: fd.midThighRight, midThighLeft: fd.midThighLeft, patellaDistanceRight: fd.patellaDistanceRight, patellaDistanceLeft: fd.patellaDistanceLeft, measurementImageUrls: [] },
      posturalAssessment: { anteriorPelvicTilt: fd.anteriorPelvicTilt, upperCrossSyndrome: fd.upperCrossSyndrome, lowerCrossSyndrome: fd.lowerCrossSyndrome, forwardHeadPosture: fd.forwardHeadPosture, roundedShoulders: fd.roundedShoulders, kyphosis: fd.kyphosis, lordosis: fd.lordosis, scoliosis: fd.scoliosis, posturalOther: fd.posturalOther, posturalOtherNotes: fd.posturalOtherNotes, posturalNotes: fd.posturalNotes },
      recommendations: { strengthRecommendations: fd.strengthRecommendations, cardioRecommendations: fd.cardioRecommendations, mobilityRecommendations: fd.mobilityRecommendations, lifestyleRecommendations: fd.lifestyleRecommendations, recommendationsNotes: fd.recommendationsNotes },
    };
  }
  if (isExistingClient) {
    sa.psychologicalAssessment = {
      readinessToChange: fd.readinessToChange, stageOfChange: fd.stageOfChange,
      perceivedBarrierToChange: fd.perceivedBarrierToChange, perceivedEffortToChange: fd.perceivedEffortToChange,
      overallStress: fd.overallStress, additionalNotes: fd.additionalNotes,
    };
  }
  return { 'Standardized Assessment': sa };
}

/* =============================== the form =============================== */
const GOALS = [
  { id: 'Aesthetics', title: 'Aesthetics', desc: 'Body composition, measurements & visual transformation', icon: 'target' },
  { id: 'Performance', title: 'Performance', desc: 'Athletic performance, strength & endurance', icon: 'trophy' },
  { id: 'Longevity', title: 'Longevity', desc: 'Health span, balance & functional movement', icon: 'heart' },
  { id: 'Postpartum Fitness Test', title: 'Postpartum', desc: 'Postpartum recovery & strength', icon: 'heart' },
  { id: 'Prenatal Fitness Test', title: 'Prenatal', desc: 'Safe fitness evaluation during pregnancy', icon: 'heart' },
  { id: 'Senior Citizen Fitness Test', title: 'Senior Citizen Fitness', desc: 'Functional fitness for older adults', icon: 'users' },
  { id: 'Hyrox', title: 'Hyrox', desc: 'Race-style strength, endurance & conditioning', icon: 'activity' },
];

export function QhpAssessmentForm({
  visible, onClose, onSuccess, assessmentId, clientId, clientName, location, isExistingClient, assessorId,
}: {
  visible: boolean; onClose: () => void; onSuccess: () => void;
  assessmentId: string; clientId: string | null; clientName: string; location: string;
  isExistingClient: boolean; assessorId: string;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [step, setStep] = React.useState(1);
  const [gadOpen, setGadOpen] = React.useState(false);
  const [newActivity, setNewActivity] = React.useState({ name: '', frequency: '' });
  const [priorPrefilled, setPriorPrefilled] = React.useState(false);

  const meQ = useQuery({
    queryKey: ['my-profile-name', assessorId],
    enabled: visible && !!assessorId,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('first_name, last_name').eq('id', assessorId).maybeSingle();
      return `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();
    },
  });

  const [fd, setFd] = React.useState<FD>(() => initialFd(clientName, location, ''));
  const set = React.useCallback((p: Partial<FD>) => setFd((prev) => ({ ...prev, ...p })), []);

  // Reset when a different assessment opens.
  React.useEffect(() => {
    if (visible) {
      setFd(initialFd(clientName, location, meQ.data ?? ''));
      setStep(1);
      setPriorPrefilled(false);
    }
  }, [visible, assessmentId]);
  React.useEffect(() => {
    if (meQ.data && !fd.assessorName) set({ assessorName: meQ.data });
  }, [meQ.data]);

  // Prior completed QHP for placeholders + prefill (existing clients only).
  const priorQ = useQuery({
    queryKey: ['prior-qhp-row', clientId, assessmentId],
    enabled: visible && isExistingClient && !!clientId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await supabase
        .from('coach_assessment')
        .select('client_name, assessment_date, location, notes, new_client_assessment_data, existing_client_assessment_data, qhp_data')
        .eq('client_id', clientId!)
        .neq('id', assessmentId)
        .not('completed', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });
  const prior = React.useMemo(() => (priorQ.data ? hydrateFromRow(priorQ.data) : null), [priorQ.data]);
  const prevArr = React.useCallback((k: string): string[] | undefined => (prior && Array.isArray(prior[k]) && (prior[k] as any[]).length ? (prior[k] as string[]) : undefined), [prior]);
  const ph = React.useCallback((k: string, fallback: string) => {
    const v = prior?.[k];
    return v !== undefined && v !== null && v !== '' && !Array.isArray(v) ? `Previous: ${v}` : fallback;
  }, [prior]);

  // One-shot prefill of steps 1-4 + psych (never tests), only into empty fields.
  React.useEffect(() => {
    if (!visible || !isExistingClient || !prior || priorPrefilled) return;
    const patch: Partial<FD> = { ...prior };
    for (const k of STEP5_KEYS) delete patch[k];
    delete patch.selectedGoal; // the assessor picks the goal fresh each time (web keeps prior goal out of step 5 exclusions, but goal drives the flow — safer to re-pick)
    setFd((prevFd) => {
      const next = { ...prevFd };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (isEmptyVal(next[k])) next[k] = v;
      }
      return next;
    });
    setPriorPrefilled(true);
  }, [visible, isExistingClient, prior, priorPrefilled]);

  // Sleep duration auto-calc (web effect).
  React.useEffect(() => {
    const d = fd.bedtime && fd.wakeTime ? sleepDuration(fd.bedtime, fd.wakeTime) : '';
    if (d !== fd.sleepDuration) set({ sleepDuration: d });
  }, [fd.bedtime, fd.wakeTime]);

  const steps = React.useMemo(() => {
    const base = ['Client Profile', 'Goal Selection', 'Medical History', 'Lifestyle & Activity', 'Assessment Tests'];
    return isExistingClient ? [...base, 'Psychological'] : base;
  }, [isExistingClient]);
  const total = steps.length;

  const submitM = useMutation({
    mutationFn: async () => {
      if (!fd.clientName || !String(fd.clientName).trim()) throw new Error('Client name is required');
      if (!fd.selectedGoal) throw new Error('Please select a goal');
      const isNewGoalType = ['Postpartum Fitness Test', 'Prenatal Fitness Test', 'Senior Citizen Fitness Test'].includes(fd.selectedGoal);
      const assessmentData = buildAssessmentData(fd, isExistingClient);
      const payload: Record<string, any> = {
        [isNewGoalType ? 'qhp_data' : 'new_client_assessment_data']: assessmentData,
        notes: fd.recommendationsNotes || 'Standardized Assessment Completed',
        assessment_date: new Date().toISOString().split('T')[0],
        location: fd.location || '',
        client_name: String(fd.clientName).trim(),
        completed: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('coach_assessment').update(payload).eq('id', assessmentId).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error('Save was blocked (no rows updated) — check permissions.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qhp-assessments'] });
      qc.invalidateQueries({ queryKey: ['qhp-manager'] });
      onSuccess();
      // Alert only after the form Modal has finished dismissing (iOS presentation safety).
      setTimeout(() => Alert.alert('Assessment saved', 'The QHP assessment was completed successfully.'), 650);
    },
    onError: (e: any) => Alert.alert('Save failed', e?.message ?? 'Try again.'),
  });

  const next = () => {
    if (step === 2 && !fd.selectedGoal) { Alert.alert('Select a goal', 'Please select a goal before proceeding.'); return; }
    if (step < total) setStep(step + 1);
  };
  const confirmClose = () => {
    Alert.alert('Close form?', 'This will lose all progress in this assessment.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: onClose },
    ]);
  };

  const clientAgeN = parseInt(fd.clientAge) || 0;
  const clientWeightN = parseFloat(fd.clientWeight) || 0;

  /* ---------- steps render ---------- */
  const renderStep = () => {
    switch (steps[step - 1]) {
      case 'Client Profile':
        return (
          <View style={{ gap: 12 }}>
            <Sec title="Basic Info">
              <Row2>
                <Half><L>Assessment Date</L><Inp v={fd.assessmentDate} readOnly /></Half>
                <Half><L>Assessor</L><Inp v={fd.assessorName} on={(t) => set({ assessorName: t })} ph="Your name" /></Half>
              </Row2>
              <View><L>Client</L><Inp v={fd.clientName} readOnly /></View>
              <Row2>
                <Half>
                  <L>Date of Birth (YYYY-MM-DD)</L>
                  <Inp v={fd.clientDob} on={(t) => {
                    const d = new Date(t);
                    const age = t.length === 10 && !Number.isNaN(d.getTime()) ? Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
                    set({ clientDob: t, ...(age !== null ? { clientAge: String(age) } : {}) });
                  }} ph={ph('clientDob', 'e.g. 1990-05-21')} />
                </Half>
                <Half><L>Age</L><Inp v={fd.clientAge} readOnly ph="Auto" /></Half>
              </Row2>
              <View><L>Gender</L><Sel v={fd.clientGender} on={(v) => set({ clientGender: v })} options={[{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }, { v: 'other', l: 'Other' }, { v: 'prefer_not_to_say', l: 'Prefer not to say' }]} /></View>
              <View><L>Profession</L><Inp v={fd.clientProfession} on={(t) => set({ clientProfession: t })} ph={ph('clientProfession', 'Profession')} /></View>
              <Row2>
                <Half><L>Height</L><Inp v={fd.clientHeight} on={(t) => set({ clientHeight: t })} ph={ph('clientHeight', "e.g. 5'8 ft, 172 cm")} /></Half>
                <Half><L>Weight</L><Inp v={fd.clientWeight} on={(t) => set({ clientWeight: t })} ph={ph('clientWeight', 'e.g. 70 kg')} /></Half>
              </Row2>
            </Sec>
          </View>
        );
      case 'Goal Selection':
        return (
          <View style={{ gap: 9 }}>
            {GOALS.map((g) => {
              const on = fd.selectedGoal === g.id;
              return (
                <Pressable key={g.id} onPress={() => set({ selectedGoal: g.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: on ? hexA(C.orange, 0.12) : 'rgba(0,0,0,0.25)', borderWidth: 1.5, borderColor: on ? hexA(C.orange, 0.6) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(on ? C.orange : C.blue, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={g.icon as any} size={17} color={on ? C.orange : C.blue} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: on ? C.orange : '#fff' }}>{g.title}</Body>
                    <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{g.desc}</Body>
                  </View>
                  {on ? <Icon path="M20 6 9 17l-5-5" size={16} color={C.orange} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </View>
        );
      case 'Medical History':
        return (
          <View style={{ gap: 12 }}>
            <Sec title="Heart Math Report" tint={C.purple}>
              <Row2>
                <Half><L>MHRR, bpm</L><Inp v={fd.heartMathMHRR} on={(t) => set({ heartMathMHRR: t })} ph={ph('heartMathMHRR', 'Enter MHRR')} num /></Half>
                <Half><L>SDNN, msec</L><Inp v={fd.heartMathSDNN} on={(t) => set({ heartMathSDNN: t })} ph={ph('heartMathSDNN', 'Enter SDNN')} num /></Half>
              </Row2>
              <Row2>
                <Half><L>RMSSD, msec</L><Inp v={fd.heartMathRMSSD} on={(t) => set({ heartMathRMSSD: t })} ph={ph('heartMathRMSSD', 'Enter RMSSD')} num /></Half>
                <Half><L>Normalized Coherence, %</L><Inp v={fd.heartMathNormalizedCoherence} on={(t) => set({ heartMathNormalizedCoherence: t })} ph={ph('heartMathNormalizedCoherence', 'Enter coherence %')} num /></Half>
              </Row2>
            </Sec>
            <Sec title="Chronic Conditions">
              <Chks items={['Hypertension', 'CVD', 'Diabetes', 'Thyroid Disorder', 'Kidney Disorder', 'Liver Disorder', 'Dyslipidemia (Cholesterol)', 'Other']} selected={fd.chronicConditions} onToggle={(v) => set({ chronicConditions: toggleArr(fd.chronicConditions, v) })} prev={prevArr('chronicConditions')} />
              {fd.chronicConditions.includes('Other') ? <Inp v={fd.chronicConditionsOther} on={(t) => set({ chronicConditionsOther: t })} ph={ph('chronicConditionsOther', 'Specify other chronic conditions')} /> : null}
            </Sec>
            <Sec title="Current Medications">
              <Chks items={['Blood Pressure', 'Diabetes', 'Cholesterol', 'Pain Killer', 'Other']} selected={fd.currentMedications} onToggle={(v) => set({ currentMedications: toggleArr(fd.currentMedications, v) })} prev={prevArr('currentMedications')} />
              {fd.currentMedications.includes('Other') ? <Inp v={fd.currentMedicationsOther} on={(t) => set({ currentMedicationsOther: t })} ph={ph('currentMedicationsOther', 'Specify other medications')} /> : null}
            </Sec>
            <Sec title="Past Injuries">
              <L>Upper Body</L>
              <Chks items={['Cervical', 'Shoulder', 'Spine', 'Other']} selected={fd.pastInjuriesUpper} onToggle={(v) => set({ pastInjuriesUpper: toggleArr(fd.pastInjuriesUpper, v) })} prev={prevArr('pastInjuriesUpper')} />
              {fd.pastInjuriesUpper.includes('Other') ? <Inp v={fd.pastInjuriesUpperOther} on={(t) => set({ pastInjuriesUpperOther: t })} ph={ph('pastInjuriesUpperOther', 'Specify other upper body injuries')} /> : null}
              <L>Lower Body</L>
              <Chks items={['Lower Back', 'Hips', 'Knee', 'Ankle', 'Other']} selected={fd.pastInjuriesLower} onToggle={(v) => set({ pastInjuriesLower: toggleArr(fd.pastInjuriesLower, v) })} prev={prevArr('pastInjuriesLower')} />
              {fd.pastInjuriesLower.includes('Other') ? <Inp v={fd.pastInjuriesLowerOther} on={(t) => set({ pastInjuriesLowerOther: t })} ph={ph('pastInjuriesLowerOther', 'Specify other lower body injuries')} /> : null}
            </Sec>
            <Sec title="Surgical History"><Inp v={fd.surgicalHistory} on={(t) => set({ surgicalHistory: t })} ph={ph('surgicalHistory', 'Describe any past surgeries...')} multi /></Sec>
            <Sec title="Pain / Discomfort Areas"><Inp v={fd.painDiscomfortAreas} on={(t) => set({ painDiscomfortAreas: t })} ph={ph('painDiscomfortAreas', 'Describe current pain or discomfort areas...')} multi /></Sec>
          </View>
        );
      case 'Lifestyle & Activity':
        return (
          <View style={{ gap: 12 }}>
            <Sec title="Activity History">
              <L>Past Activity (not prior than 5 years)</L>
              <Chks items={['Tennis', 'Golf', 'Strength Training', 'Football', 'Cricket', 'Yoga', 'Swimming', 'Running', 'Paddle', 'Pickleball', 'Other']} selected={fd.pastActivities} onToggle={(v) => set({ pastActivities: toggleArr(fd.pastActivities, v) })} prev={prevArr('pastActivities')} />
              {fd.pastActivities.includes('Other') ? <Inp v={fd.pastActivitiesOther} on={(t) => set({ pastActivitiesOther: t })} ph={ph('pastActivitiesOther', 'Specify other past activities')} /> : null}
              <L>Current Activities</L>
              <Row2>
                <Half><Inp v={newActivity.name} on={(t) => setNewActivity((a) => ({ ...a, name: t }))} ph="Activity name" /></Half>
              </Row2>
              <Sel v={newActivity.frequency} on={(v) => setNewActivity((a) => ({ ...a, frequency: v }))} options={[{ v: 'Daily', l: 'Daily' }, { v: 'Few times a week', l: 'Few times a week' }, { v: 'Weekly', l: 'Weekly' }, { v: 'Monthly', l: 'Monthly' }, { v: 'Rarely', l: 'Rarely' }]} />
              <Pressable
                disabled={!newActivity.name.trim() || !newActivity.frequency}
                onPress={() => { set({ currentActivities: [...fd.currentActivities, `${newActivity.name.trim()} (${newActivity.frequency})`] }); setNewActivity({ name: '', frequency: '' }); }}
                style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), opacity: !newActivity.name.trim() || !newActivity.frequency ? 0.4 : 1 }}
              >
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>+ Add Activity</Text>
              </Pressable>
              {fd.currentActivities.map((a: string, i: number) => (
                <View key={a + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: IN_BD }}>
                  <Body style={{ flex: 1, fontSize: 12, color: '#fff' }}>{a}</Body>
                  <Pressable onPress={() => set({ currentActivities: fd.currentActivities.filter((_: string, x: number) => x !== i) })}>
                    <Icon name="close" size={12} color={C.red} strokeWidth={2.4} />
                  </Pressable>
                </View>
              ))}
            </Sec>
            <Sec title="Lifestyle Assessment">
              <L>Lifestyle Type</L>
              <Sel v={fd.lifestyleType} on={(v) => set({ lifestyleType: v })} options={[{ v: 'sedentary', l: 'Sedentary' }, { v: 'lightly_active', l: 'Lightly Active' }, { v: 'moderately_active', l: 'Moderately Active' }, { v: 'very_active', l: 'Very Active' }]} />
              <View><L>Daily Step Count</L><Inp v={fd.dailyStepCount} on={(t) => set({ dailyStepCount: t })} ph={ph('dailyStepCount', 'Daily steps')} num /></View>
              <L>Work Place — get up from desk in</L>
              <Sel v={fd.workGetupFrequency} on={(v) => set({ workGetupFrequency: v })} options={[{ v: 'Every Hour', l: 'Every Hour' }, { v: '4 Hours', l: '4 Hours' }, { v: '6 Hours', l: '6 Hours' }, { v: 'Completely Desk Job', l: 'Completely Desk Job' }]} />
            </Sec>
            <Sec title="Habits">
              {['Smoking', 'Alcohol', 'Tobacco'].map((h) => {
                const on = fd.habits.includes(h);
                return (
                  <View key={h} style={{ gap: 7 }}>
                    <Chks items={[h]} selected={fd.habits} onToggle={(v) => set({ habits: toggleArr(fd.habits, v) })} prev={prevArr('habits')} />
                    {on ? (
                      <Sel v={fd.habitFrequencies[h] ?? ''} on={(v) => set({ habitFrequencies: { ...fd.habitFrequencies, [h]: v } })} options={[{ v: 'daily', l: 'Daily' }, { v: 'few_times_week', l: 'Few times a week' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }, { v: 'rarely', l: 'Rarely' }]} />
                    ) : null}
                  </View>
                );
              })}
              <Chks items={['Other']} selected={fd.habits} onToggle={(v) => set({ habits: toggleArr(fd.habits, v) })} />
              {fd.habits.includes('Other') ? <Inp v={fd.habitsOther} on={(t) => set({ habitsOther: t })} ph={ph('habitsOther', 'Specify other habits')} /> : null}
            </Sec>
            <Sec title="Sleep Pattern" tint={C.blue}>
              <Row2>
                <Half><L>Bedtime (HH:MM)</L><Inp v={fd.bedtime} on={(t) => set({ bedtime: t })} ph={ph('bedtime', 'e.g. 23:00')} /></Half>
                <Half><L>Wake Time (HH:MM)</L><Inp v={fd.wakeTime} on={(t) => set({ wakeTime: t })} ph={ph('wakeTime', 'e.g. 06:30')} /></Half>
              </Row2>
              <Row2>
                <Half><L>Sleep Duration</L><Inp v={fd.sleepDuration} readOnly ph="Calculated automatically" /></Half>
              </Row2>
              <L>Sleep Quality</L>
              <Sel v={fd.sleepQuality} on={(v) => set({ sleepQuality: v })} options={[{ v: 'stay_asleep', l: 'Stay asleep throughout night' }, { v: 'wakeup_often', l: 'Wakeup often at night' }]} />
              <View><L>Sleep Notes</L><Inp v={fd.sleepNotes} on={(t) => set({ sleepNotes: t })} ph="Any sleep issues, disturbances, or patterns to note..." multi /></View>
            </Sec>
            <Sec title="Goals" tint={C.green}>
              <Chks items={['Fat / Weight Loss', 'Muscle Gain/Hypertrophy', 'Improve Mobility/Flexibility', 'Health Optimization', 'Strength', 'Performance', 'Body Re-composition', 'All of the Above']} selected={fd.goals} onToggle={(v) => set({ goals: toggleArr(fd.goals, v) })} prev={prevArr('goals')} />
              <View><L>Goals Notes</L><Inp v={fd.goalsNotes} on={(t) => set({ goalsNotes: t })} ph="Goals and objectives..." multi /></View>
            </Sec>
            <Sec title="GI Profile / Food Sensitivity" tint={C.gold}>
              <L>Dietary Preferences</L>
              <Chks items={['Veg', 'Non-veg', 'Egg+veg', 'Other']} selected={fd.dietaryPreferences} onToggle={(v) => set({ dietaryPreferences: toggleArr(fd.dietaryPreferences, v) })} prev={prevArr('dietaryPreferences')} />
              <View><L>Dietary Details</L><Inp v={fd.dietaryNotes} on={(t) => set({ dietaryNotes: t })} ph="Typical daily meals, eating patterns..." multi /></View>
              <L>Food Intolerances / Allergies</L>
              <Chks items={['Gluten', 'Lactose', 'Nut Allergy', 'Soy', 'Other']} selected={fd.foodIntolerance} onToggle={(v) => set({ foodIntolerance: toggleArr(fd.foodIntolerance, v) })} prev={prevArr('foodIntolerance')} />
              {fd.foodIntolerance.includes('Other') ? <Inp v={fd.foodIntoleranceOther} on={(t) => set({ foodIntoleranceOther: t })} ph={ph('foodIntoleranceOther', 'Specify other intolerances')} /> : null}
              <L>Current Supplements</L>
              <Chks items={['Magnesium', 'Theanine', 'Melatonin', 'Chamomile', 'Vitamin-D', 'Vitamin-B', 'Other']} selected={fd.currentSupplements} onToggle={(v) => set({ currentSupplements: toggleArr(fd.currentSupplements, v) })} prev={prevArr('currentSupplements')} />
              {fd.currentSupplements.includes('Other') ? <Inp v={fd.currentSupplementsOther} on={(t) => set({ currentSupplementsOther: t })} ph={ph('currentSupplementsOther', 'Specify other supplements')} /> : null}
              <L>Dietary Restrictions</L>
              <Chks items={['Wheat', 'Rice', 'Dairy', 'Red Meat', 'Sea Food', 'Other']} selected={fd.dietaryRestrictions} onToggle={(v) => set({ dietaryRestrictions: toggleArr(fd.dietaryRestrictions, v) })} prev={prevArr('dietaryRestrictions')} />
              {fd.dietaryRestrictions.includes('Other') ? <Inp v={fd.dietaryRestrictionsOther} on={(t) => set({ dietaryRestrictionsOther: t })} ph={ph('dietaryRestrictionsOther', 'Specify other dietary restrictions')} /> : null}
              <L>Digestion</L>
              <Chks items={['Constipation', 'Bloating', 'Inconsistency in Bowel Movement', 'All of the Above', 'Other']} selected={fd.digestionIssues} onToggle={(v) => set({ digestionIssues: toggleArr(fd.digestionIssues, v) })} prev={prevArr('digestionIssues')} />
              {fd.digestionIssues.includes('Other') ? <Inp v={fd.digestionIssuesOther} on={(t) => set({ digestionIssuesOther: t })} ph={ph('digestionIssuesOther', 'Specify other digestion issues')} /> : null}
              <L>Homeostasis Signals</L>
              <Chks items={['Drowsiness', 'Cravings', 'Energy Dips']} selected={fd.homeostasisSignals} onToggle={(v) => set({ homeostasisSignals: toggleArr(fd.homeostasisSignals, v) })} prev={prevArr('homeostasisSignals')} />
              <L>Appetite Level</L>
              <Sel v={fd.appetite} on={(v) => set({ appetite: v })} options={[{ v: 'poor', l: 'Poor — little to no desire to eat' }, { v: 'good', l: 'Good — normal eating patterns' }, { v: 'excessive', l: 'Excessive — over eating' }]} />
              <L>Traveling / Social Eating Frequency</L>
              <Sel v={fd.travelingSocialFrequency} on={(v) => set({ travelingSocialFrequency: v })} options={[{ v: 'never', l: 'Never' }, { v: 'rarely', l: 'Rarely (1-2/mo)' }, { v: 'occasionally', l: 'Occasionally (3-4/mo)' }, { v: 'frequently', l: 'Frequently (1-2/wk)' }, { v: 'very_frequently', l: 'Very Frequently (3+/wk)' }]} />
            </Sec>
            <Sec title="Additional Lifestyle Notes"><Inp v={fd.lifestyleNotes} on={(t) => set({ lifestyleNotes: t })} ph="Anything else that might affect the health and fitness journey..." multi /></Sec>
          </View>
        );
      case 'Assessment Tests': {
        const goal = fd.selectedGoal;
        if (goal === 'Postpartum Fitness Test' || goal === 'Prenatal Fitness Test') {
          const p = goal === 'Prenatal Fitness Test';
          const k = (base: string, pre: string) => (p ? pre : base);
          return (
            <View style={{ gap: 12 }}>
              <Pressable onPress={() => setGadOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 13, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.35) }}>
                <Icon name="heart" size={15} color={C.purple} strokeWidth={2} />
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 12.5, color: C.purple }}>GAD-7 Anxiety Screening{fd.gad_7_score !== undefined ? `  ·  Score ${fd.gad_7_score} — ${fd.gad_7_result}` : ''}</Text>
                <Icon name="chevRight" size={13} color={C.purple} strokeWidth={2.2} />
              </Pressable>
              <Sec title="A. Medical & Vital Screening" tint={C.red}>
                <Row2>
                  <Half><L>Blood Pressure</L><Inp v={fd[k('bloodPressure', 'prenatalBloodPressure')]} on={(t) => set({ [k('bloodPressure', 'prenatalBloodPressure')]: t })} ph="e.g. 120/80" /></Half>
                  <Half><L>Resting Heart Rate</L><Inp v={fd[k('restingHeartRate', 'prenatalRestingHeartRate')]} on={(t) => set({ [k('restingHeartRate', 'prenatalRestingHeartRate')]: t })} ph="bpm" num /></Half>
                </Row2>
                <View><L>Fasting Glucose</L><Inp v={fd[k('fastingGlucose', 'prenatalFastingGlucose')]} on={(t) => set({ [k('fastingGlucose', 'prenatalFastingGlucose')]: t })} ph="mg/dL" num /></View>
                <View><L>Notes</L><Inp v={fd[k('postpartumMedicalNotes', 'prenatalMedicalNotes')]} on={(t) => set({ [k('postpartumMedicalNotes', 'prenatalMedicalNotes')]: t })} ph="Additional notes" multi /></View>
              </Sec>
              <Sec title="B. Cardiovascular Endurance" tint={C.blue}>
                <View><L>6-Minute Walk Test</L><Inp v={fd[k('sixMinuteWalk', 'prenatalSixMinuteWalk')]} on={(t) => set({ [k('sixMinuteWalk', 'prenatalSixMinuteWalk')]: t })} ph="Distance covered" /></View>
                <Row2>
                  <Half><L>Hand Grip Strength (kg)</L><Inp v={fd[k('handGripStrengthKg', 'prenatalHandGripStrengthKg')]} on={(t) => set({ [k('handGripStrengthKg', 'prenatalHandGripStrengthKg')]: t })} ph="kg" num /></Half>
                  <Half><L>Sit-to-Stand (30 sec)</L><Inp v={fd[k('sitToStand30Sec', 'prenatalSitToStand30Sec')]} on={(t) => set({ [k('sitToStand30Sec', 'prenatalSitToStand30Sec')]: t })} ph="Repetitions" num /></Half>
                </Row2>
              </Sec>
              <Sec title={p ? 'C. Core & Pelvic Stability + Mobility' : 'C. Core & Pelvic Stability'} tint={C.green}>
                <Row2>
                  <Half><L>Modified Plank (sec)</L><Inp v={fd[k('modifiedPlankSec', 'prenatalModifiedPlankSec')]} on={(t) => set({ [k('modifiedPlankSec', 'prenatalModifiedPlankSec')]: t })} ph="seconds" num /></Half>
                  <Half><L>Glute Bridge</L><Inp v={fd[k('gluteBridge', 'prenatalGluteBridge')]} on={(t) => set({ [k('gluteBridge', 'prenatalGluteBridge')]: t })} ph="Result" /></Half>
                </Row2>
                <Row2>
                  <Half><L>ASLR - Right Leg</L><Inp v={fd[k('aslrRight', 'prenatalAslrRight')]} on={(t) => set({ [k('aslrRight', 'prenatalAslrRight')]: t })} ph="Score" num /></Half>
                  <Half><L>ASLR - Left Leg</L><Inp v={fd[k('aslrLeft', 'prenatalAslrLeft')]} on={(t) => set({ [k('aslrLeft', 'prenatalAslrLeft')]: t })} ph="Score" num /></Half>
                </Row2>
                {p ? (
                  <>
                    <Row2>
                      <Half><L>Sit & Reach</L><Inp v={fd.flexibilitySitReach} on={(t) => set({ flexibilitySitReach: t })} ph="Distance" /></Half>
                      <Half><L>Overhead Squat</L><Inp v={fd.overheadSquat} on={(t) => set({ overheadSquat: t })} ph="Result" /></Half>
                    </Row2>
                    <Row2>
                      <Half><L>Apley Zipper - Right</L><Inp v={fd.apleyZipperRight} on={(t) => set({ apleyZipperRight: t })} ph="Result" /></Half>
                      <Half><L>Apley Zipper - Left</L><Inp v={fd.apleyZipperLeft} on={(t) => set({ apleyZipperLeft: t })} ph="Result" /></Half>
                    </Row2>
                  </>
                ) : null}
              </Sec>
              {!p ? (
                <>
                  <Sec title="D. Diastasis Recti Abdominis (DRA)" tint={C.gold}>
                    <View><L>DRA Measurement (inches)</L><Inp v={fd.draInches} on={(t) => set({ draInches: t })} ph="inches" num /></View>
                  </Sec>
                  <Sec title="E. Balance" tint={C.purple}>
                    <Row2>
                      <Half><L>Single Leg Balance - Right (sec)</L><Inp v={fd.singleLegBalanceRightSec} on={(t) => set({ singleLegBalanceRightSec: t })} ph="seconds" num /></Half>
                      <Half><L>Single Leg Balance - Left (sec)</L><Inp v={fd.singleLegBalanceLeftSec} on={(t) => set({ singleLegBalanceLeftSec: t })} ph="seconds" num /></Half>
                    </Row2>
                  </Sec>
                </>
              ) : null}
              <Sec title="Additional Notes"><Inp v={fd[k('postpartumTestsNotes', 'prenatalTestsNotes')]} on={(t) => set({ [k('postpartumTestsNotes', 'prenatalTestsNotes')]: t })} ph="Any additional observations" multi /></Sec>
            </View>
          );
        }
        if (goal === 'Senior Citizen Fitness Test') {
          return (
            <View style={{ gap: 12 }}>
              <Sec title="A. Senior Fitness Tests">
                <Row2>
                  <Half><L>30-Second Chair Stand</L><Inp v={fd.chairStand30Sec} on={(t) => set({ chairStand30Sec: t })} ph={ph('chairStand30Sec', 'Repetitions')} num /></Half>
                  <Half><L>2-Minute Step Test</L><Inp v={fd.twoMinuteStepTest} on={(t) => set({ twoMinuteStepTest: t })} ph={ph('twoMinuteStepTest', 'Steps')} num /></Half>
                </Row2>
                <Row2>
                  <Half><L>Arm Curl (Male - 8 lbs)</L><Inp v={fd.armCurlMale8lbs} on={(t) => set({ armCurlMale8lbs: t })} ph={ph('armCurlMale8lbs', 'Repetitions')} num /></Half>
                  <Half><L>Arm Curl (Female - 5 lbs)</L><Inp v={fd.armCurlFemale5lbs} on={(t) => set({ armCurlFemale5lbs: t })} ph={ph('armCurlFemale5lbs', 'Repetitions')} num /></Half>
                </Row2>
                <Row2>
                  <Half><L>Chair Sit-and-Reach (cm)</L><Inp v={fd.chairSitAndReach} on={(t) => set({ chairSitAndReach: t })} ph={ph('chairSitAndReach', 'Distance (cm)')} num /></Half>
                  <Half><L>Back Scratch Test (cm)</L><Inp v={fd.backScratchTest} on={(t) => set({ backScratchTest: t })} ph={ph('backScratchTest', 'Distance (cm)')} num /></Half>
                </Row2>
                <View><L>8-Foot Up-and-Go (sec)</L><Inp v={fd.eightFootUpAndGoSec} on={(t) => set({ eightFootUpAndGoSec: t })} ph={ph('eightFootUpAndGoSec', 'seconds')} num /></View>
                <View><L>Additional Notes</L><Inp v={fd.seniorTestsNotes} on={(t) => set({ seniorTestsNotes: t })} ph="Any additional observations" multi /></View>
              </Sec>
            </View>
          );
        }
        // Standard goals: Aesthetics / Performance / Longevity / Hyrox
        const perfCard = (
          <Sec title="Performance Goal Tests" tint={C.blue}>
            <Vo2Card fd={fd} keys={{ method: 'vo2MaxMethod', value: 'vo2MaxPerformance', heartRate: 'vo2MaxHeartRate', timeDuration: 'vo2MaxTimeDuration', cooperDistance: 'vo2MaxCooperDistance' }} clientGender={fd.clientGender} clientAge={clientAgeN} clientWeight={clientWeightN} onPatch={(pch) => { if (goal === 'Longevity' && pch.vo2MaxPerformance !== undefined) pch.vo2MaxLongevity = pch.vo2MaxPerformance; set(pch); }} />
            <Row2>
              <Half><L>Broad Jump (cm)</L><Inp v={fd.broadJump} on={(t) => set({ broadJump: t })} ph={ph('broadJump', 'Distance in cm')} num /></Half>
              <Half><L>Max Push-ups (1 min)</L><Inp v={fd.maxPushupsOneMinute} on={(t) => set({ maxPushupsOneMinute: t })} ph={ph('maxPushupsOneMinute', 'Count')} num /></Half>
            </Row2>
            <Row2>
              <Half><L>Max BW Squats (1 min)</L><Inp v={fd.maxBodyweightSquatOneMinute} on={(t) => set({ maxBodyweightSquatOneMinute: t })} ph={ph('maxBodyweightSquatOneMinute', 'Count')} num /></Half>
              <Half><L>Chin-ups (1 min)</L><Inp v={fd.chinUpOneMinute} on={(t) => set({ chinUpOneMinute: t })} ph={ph('chinUpOneMinute', 'Count')} num /></Half>
            </Row2>
            <Row2>
              <Half><L>Plank Max (1 min, sec)</L><Inp v={fd.plankMaxOneMinute} on={(t) => set({ plankMaxOneMinute: t })} ph={ph('plankMaxOneMinute', 'Seconds')} num /></Half>
              <Half><L>Sit-ups (1 min)</L><Inp v={fd.situpOneMinute} on={(t) => set({ situpOneMinute: t })} ph={ph('situpOneMinute', 'Count')} num /></Half>
            </Row2>
            <View><L>Performance Tests Notes</L><Inp v={fd.performanceTestsNotes} on={(t) => set({ performanceTestsNotes: t })} ph="Additional notes for performance tests" multi /></View>
          </Sec>
        );
        return (
          <View style={{ gap: 12 }}>
            <Sec title="Common Assessment Tests">
              <Row2>
                <Half><L>ASLR - Right (of 3)</L><Inp v={fd.aslrRightLeg} on={(t) => set({ aslrRightLeg: t })} ph={ph('aslrRightLeg', 'Score out of 3')} num /></Half>
                <Half><L>ASLR - Left (of 3)</L><Inp v={fd.aslrLeftLeg} on={(t) => set({ aslrLeftLeg: t })} ph={ph('aslrLeftLeg', 'Score out of 3')} num /></Half>
              </Row2>
              <Row2>
                <Half><L>APLEY - Left Hand Over</L><Inp v={fd.apleTestLeftHandOver} on={(t) => set({ apleTestLeftHandOver: t })} ph={ph('apleTestLeftHandOver', 'Score out of 3')} num /></Half>
                <Half><L>APLEY - Right Hand Over</L><Inp v={fd.apleTestRightHandOver} on={(t) => set({ apleTestRightHandOver: t })} ph={ph('apleTestRightHandOver', 'Score out of 3')} num /></Half>
              </Row2>
              <Row2>
                <Half><L>Sit and Reach (of 3)</L><Inp v={fd.sitReachScore} on={(t) => set({ sitReachScore: t })} ph={ph('sitReachScore', 'Score out of 3')} num /></Half>
                <Half><L>Overhead Squat (of 3)</L><Inp v={fd.overheadSquatScore} on={(t) => set({ overheadSquatScore: t })} ph={ph('overheadSquatScore', 'Score out of 3')} num /></Half>
              </Row2>
              <View><L>Common Tests Notes</L><Inp v={fd.commonTestsNotes} on={(t) => set({ commonTestsNotes: t })} ph="Additional observations about common tests" multi /></View>
            </Sec>
            {goal === 'Aesthetics' ? (
              <Sec title="Aesthetics Goal Tests" tint={C.gold}>
                <Row2>
                  <Half><L>Wall Sit (sec)</L><Inp v={fd.wallSit} on={(t) => set({ wallSit: t })} ph={ph('wallSit', 'Time in seconds')} num /></Half>
                  <Half><L>Grip Strength (kg)</L><Inp v={fd.gripStrengthLongevity} on={(t) => set({ gripStrengthLongevity: t })} ph="Strength in kg" num /></Half>
                </Row2>
                <Row2>
                  <Half><L>Sit to Stand Score</L><Inp v={fd.sitToStandScore} on={(t) => set({ sitToStandScore: t })} ph="Score" num /></Half>
                  <Half><L>Stand to Sit Score</L><Inp v={fd.standToSitScore} on={(t) => set({ standToSitScore: t })} ph="Score" num /></Half>
                </Row2>
                <View><L>Aesthetics Tests Notes</L><Inp v={fd.aestheticsTestsNotes} on={(t) => set({ aestheticsTestsNotes: t })} ph="Additional notes for aesthetics tests" multi /></View>
              </Sec>
            ) : null}
            {goal === 'Longevity' ? (
              <Sec title="Longevity Goal Tests" tint={C.green}>
                <Row2>
                  <Half><L>Right Leg Balance (max 30s)</L><Inp v={fd.rightLegBalanceMax30Sec} on={(t) => set({ rightLegBalanceMax30Sec: t })} ph="Seconds" num /></Half>
                  <Half><L>Left Leg Balance (max 30s)</L><Inp v={fd.leftLegBalanceMax30Sec} on={(t) => set({ leftLegBalanceMax30Sec: t })} ph="Seconds" num /></Half>
                </Row2>
                <Row2>
                  <Half><L>Sit to Stand Score</L><Inp v={fd.sitToStandScore} on={(t) => set({ sitToStandScore: t })} ph="Score" num /></Half>
                  <Half><L>Stand to Sit Score</L><Inp v={fd.standToSitScore} on={(t) => set({ standToSitScore: t })} ph="Score" num /></Half>
                </Row2>
                <View><L>Grip Strength (kg)</L><Inp v={fd.gripStrengthLongevity} on={(t) => set({ gripStrengthLongevity: t })} ph="Strength in kg" num /></View>
                <View><L>Longevity Tests Notes</L><Inp v={fd.longevityTestsNotes} on={(t) => set({ longevityTestsNotes: t })} ph="Additional notes for longevity tests" multi /></View>
              </Sec>
            ) : null}
            {goal === 'Hyrox' ? (
              <Sec title="Hyrox Goal Tests" tint={C.red}>
                <Vo2Card fd={fd} keys={{ method: 'hyroxVo2MaxMethod', value: 'hyroxVo2Max', heartRate: 'hyroxVo2MaxHeartRate', timeDuration: 'hyroxVo2MaxTimeDuration', cooperDistance: 'hyroxVo2MaxCooperDistance' }} clientGender={fd.clientGender} clientAge={clientAgeN} clientWeight={clientWeightN} onPatch={set} />
                <Row2>
                  <Half><L>Grip Strength (kg)</L><Inp v={fd.hyroxGripStrength} on={(t) => set({ hyroxGripStrength: t })} ph={ph('hyroxGripStrength', 'kg')} num /></Half>
                  <Half><L>100 Wall Balls (mm:ss)</L><Inp v={fd.hyroxWallBalls} on={(t) => set({ hyroxWallBalls: t })} ph={ph('hyroxWallBalls', 'e.g. 4:30')} /></Half>
                </Row2>
                <Row2>
                  <Half><L>30 HR Push-Ups (mm:ss)</L><Inp v={fd.hyroxHandReleasePushups} on={(t) => set({ hyroxHandReleasePushups: t })} ph={ph('hyroxHandReleasePushups', 'e.g. 2:30')} /></Half>
                  <Half><L>1000 m Row (mm:ss)</L><Inp v={fd.hyroxRowTime1000m} on={(t) => set({ hyroxRowTime1000m: t })} ph={ph('hyroxRowTime1000m', 'e.g. 3:45')} /></Half>
                </Row2>
                <Row2>
                  <Half><L>50 Burpee Broad Jumps</L><Inp v={fd.hyroxBurpeeBroadJumps} on={(t) => set({ hyroxBurpeeBroadJumps: t })} ph={ph('hyroxBurpeeBroadJumps', 'e.g. 5:00')} /></Half>
                  <Half><L>Stationary Lunges ×100</L><Inp v={fd.hyroxStationaryLungesTime} on={(t) => set({ hyroxStationaryLungesTime: t })} ph={ph('hyroxStationaryLungesTime', 'e.g. 4:20')} /></Half>
                </Row2>
                <View><L>Notes</L><Inp v={fd.hyroxTestsNotes} on={(t) => set({ hyroxTestsNotes: t })} ph="Additional notes for Hyrox tests" multi /></View>
              </Sec>
            ) : null}
            {goal === 'Longevity' ? (
              <Vo2Card fd={fd} keys={{ method: 'vo2MaxMethod', value: 'vo2MaxLongevity', heartRate: 'vo2MaxHeartRate', timeDuration: 'vo2MaxTimeDuration', cooperDistance: 'vo2MaxCooperDistance' }} clientGender={fd.clientGender} clientAge={clientAgeN} clientWeight={clientWeightN} onPatch={(pch) => { if (pch.vo2MaxLongevity !== undefined) pch.vo2MaxPerformance = pch.vo2MaxLongevity; set(pch); }} />
            ) : null}
            {goal !== 'Hyrox' ? perfCard : null}
            <Sec title="Body Measurements" tint={C.purple}>
              {[['waistNarrow', 'Waist Narrow'], ['waistWide', 'Waist Wide'], ['hip', 'Hip'], ['chest', 'Chest'], ['midArmRight', 'Mid Arm Right'], ['midArmLeft', 'Mid Arm Left'], ['midThighRight', 'Mid Thigh Right'], ['midThighLeft', 'Mid Thigh Left'], ['patellaDistanceRight', 'Patella Distance Right'], ['patellaDistanceLeft', 'Patella Distance Left']].reduce<string[][][]>((rows, kv, i) => {
                if (i % 2 === 0) rows.push([kv]); else rows[rows.length - 1].push(kv);
                return rows;
              }, []).map((row, i) => (
                <Row2 key={i}>
                  {row.map(([k2, lab]) => (
                    <Half key={k2}><L>{lab} (cm/inch)</L><Inp v={fd[k2]} on={(t) => set({ [k2]: t })} ph={ph(k2, 'Measurement')} num /></Half>
                  ))}
                </Row2>
              ))}
            </Sec>
            <Sec title="Postural Assessment" tint={C.gold}>
              <Chks
                items={['Anterior Pelvic Tilt', 'Upper Cross Syndrome', 'Lower Cross Syndrome', 'Forward Head Posture', 'Rounded Shoulders', 'Kyphosis', 'Lordosis', 'Scoliosis', 'Other']}
                selected={[
                  ...(fd.anteriorPelvicTilt ? ['Anterior Pelvic Tilt'] : []), ...(fd.upperCrossSyndrome ? ['Upper Cross Syndrome'] : []),
                  ...(fd.lowerCrossSyndrome ? ['Lower Cross Syndrome'] : []), ...(fd.forwardHeadPosture ? ['Forward Head Posture'] : []),
                  ...(fd.roundedShoulders ? ['Rounded Shoulders'] : []), ...(fd.kyphosis ? ['Kyphosis'] : []),
                  ...(fd.lordosis ? ['Lordosis'] : []), ...(fd.scoliosis ? ['Scoliosis'] : []), ...(fd.posturalOther ? ['Other'] : []),
                ]}
                onToggle={(v) => {
                  const map: Record<string, string> = { 'Anterior Pelvic Tilt': 'anteriorPelvicTilt', 'Upper Cross Syndrome': 'upperCrossSyndrome', 'Lower Cross Syndrome': 'lowerCrossSyndrome', 'Forward Head Posture': 'forwardHeadPosture', 'Rounded Shoulders': 'roundedShoulders', Kyphosis: 'kyphosis', Lordosis: 'lordosis', Scoliosis: 'scoliosis', Other: 'posturalOther' };
                  const k2 = map[v];
                  if (k2) set({ [k2]: !fd[k2] });
                }}
              />
              {fd.posturalOther ? <Inp v={fd.posturalOtherNotes} on={(t) => set({ posturalOtherNotes: t })} ph="Describe other postural issues" /> : null}
              <View><L>Postural Notes</L><Inp v={fd.posturalNotes} on={(t) => set({ posturalNotes: t })} ph={ph('posturalNotes', 'Additional postural observations')} multi /></View>
            </Sec>
            <Sec title="Recommendations" tint={C.green}>
              <View><L>Strength</L><Inp v={fd.strengthRecommendations} on={(t) => set({ strengthRecommendations: t })} ph={ph('strengthRecommendations', 'Strength recommendations')} multi /></View>
              <View><L>Cardio</L><Inp v={fd.cardioRecommendations} on={(t) => set({ cardioRecommendations: t })} ph={ph('cardioRecommendations', 'Cardio recommendations')} multi /></View>
              <View><L>Mobility</L><Inp v={fd.mobilityRecommendations} on={(t) => set({ mobilityRecommendations: t })} ph={ph('mobilityRecommendations', 'Mobility recommendations')} multi /></View>
              <View><L>Lifestyle</L><Inp v={fd.lifestyleRecommendations} on={(t) => set({ lifestyleRecommendations: t })} ph={ph('lifestyleRecommendations', 'Lifestyle recommendations')} multi /></View>
              <View><L>Notes</L><Inp v={fd.recommendationsNotes} on={(t) => set({ recommendationsNotes: t })} ph="Overall notes" multi /></View>
            </Sec>
          </View>
        );
      }
      case 'Psychological':
        return (
          <View style={{ gap: 12 }}>
            <Sec title="Psychological Assessment" tint={C.purple}>
              <View>
                <L>Readiness to Change (1–10)</L>
                <Inp v={fd.readinessToChange} on={(t) => { const n = parseInt(t); if (t === '' || (n >= 1 && n <= 10)) set({ readinessToChange: t }); }} ph="1 = not ready · 10 = completely ready" num />
              </View>
              <L>Stage of Change</L>
              <Sel v={fd.stageOfChange} on={(v) => set({ stageOfChange: v })} options={[{ v: 'precontemplation', l: 'Precontemplation' }, { v: 'contemplation', l: 'Contemplation' }, { v: 'preparation', l: 'Preparation' }, { v: 'action', l: 'Action' }, { v: 'maintenance', l: 'Maintenance' }]} />
              <View>
                <L>Overall Stress Level (1–10)</L>
                <Inp v={fd.overallStress} on={(t) => { const n = parseInt(t); if (t === '' || (n >= 1 && n <= 10)) set({ overallStress: t }); }} ph="1 = very low · 10 = extremely high" num />
              </View>
              <View><L>Barriers to Change</L>
                <Chks items={['Lack of time', 'Work commitments', 'Family responsibilities', 'Financial constraints', 'Lack of motivation', 'Physical limitations', 'Social pressure', 'Fear of failure', 'Lack of support', 'Previous bad experiences']} selected={fd.perceivedBarrierToChange.split(', ').filter(Boolean)} onToggle={(v) => {
                  const cur = fd.perceivedBarrierToChange.split(', ').filter(Boolean);
                  set({ perceivedBarrierToChange: toggleArr(cur, v).join(', ') });
                }} />
                <Inp v={fd.perceivedBarrierToChange} on={(t) => set({ perceivedBarrierToChange: t })} ph="Perceived barriers (free text)" multi />
              </View>
              <View><L>Efforts to Change</L>
                <Chks items={['Willing to change diet', 'Ready to exercise regularly', 'Open to lifestyle modifications', 'Committed to tracking progress', 'Seeking professional guidance', 'Building support network', 'Learning new habits', 'Setting realistic goals', 'Prioritizing health', 'Making time for wellness']} selected={fd.perceivedEffortToChange.split(', ').filter(Boolean)} onToggle={(v) => {
                  const cur = fd.perceivedEffortToChange.split(', ').filter(Boolean);
                  set({ perceivedEffortToChange: toggleArr(cur, v).join(', ') });
                }} />
                <Inp v={fd.perceivedEffortToChange} on={(t) => set({ perceivedEffortToChange: t })} ph="Efforts being made (free text)" multi />
              </View>
              <View><L>Additional Notes</L><Inp v={fd.additionalNotes} on={(t) => set({ additionalNotes: t })} ph="Additional psychological notes" multi /></View>
            </Sec>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={confirmClose}>
      <View style={{ flex: 1, backgroundColor: '#0B0807' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          {/* Header */}
          <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,150,90,0.1)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>{steps[step - 1]}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>{fd.clientName} · Step {step} of {total}{isExistingClient ? ' · Re-assessment' : ''}</Body>
              </View>
              <Pressable onPress={confirmClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {/* progress */}
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 11 }}>
              {steps.map((_, i) => (
                <View key={i} style={{ flex: 1, height: 4, borderRadius: 99, backgroundColor: i < step ? C.orange : 'rgba(255,255,255,0.08)' }} />
              ))}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {isExistingClient && priorQ.isLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ActivityIndicator size="small" color={C.gold} />
                <Body style={{ fontSize: 11, color: C.muted3 }}>Loading previous QHP for prefill…</Body>
              </View>
            ) : null}
            {renderStep()}
          </ScrollView>

          {/* Footer nav */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.1)' }}>
            <Pressable disabled={step === 1} onPress={() => setStep(step - 1)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', opacity: step === 1 ? 0.35 : 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#E8E2DC' }}>Previous</Text>
            </Pressable>
            {step < total ? (
              <Pressable onPress={next} style={{ flex: 1.6, borderRadius: 13, overflow: 'hidden' }}>
                <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#1A0D05' }}>Next</Text>
                </LinearGradient>
              </Pressable>
            ) : (
              <Pressable disabled={submitM.isPending} onPress={() => submitM.mutate()} style={{ flex: 1.6, borderRadius: 13, overflow: 'hidden', opacity: submitM.isPending ? 0.6 : 1 }}>
                <LinearGradient colors={['#57C98A', '#2F8A5C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
                  {submitM.isPending ? <ActivityIndicator size="small" color="#0A1A10" /> : null}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#0A1A10' }}>{submitM.isPending ? 'Saving…' : 'Complete Assessment'}</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
      <Gad7Sheet visible={gadOpen} onClose={() => setGadOpen(false)} onComplete={(score, result) => set({ gad_7_score: score, gad_7_result: result })} />
    </Modal>
  );
}
