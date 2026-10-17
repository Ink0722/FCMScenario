import profile from '../generated/profile.json';
import type { Question } from '../../../contracts';
export type { Question } from '../../../contracts';

// Existing development questions are compiled from shared/questionnaires/.
// Replace that content with the approved profile; do not add it to each case.
export const previewQuestions: Question[] = profile.questions;
