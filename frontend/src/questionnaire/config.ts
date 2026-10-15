export interface Question {
  id: string;
  title: string;
  required: boolean;
  options: { value: string; label: string }[];
}

// Interaction examples only. Replace with the approved questionnaire supplied
// by the backend; these are not financial literacy or profile measures.
export const previewQuestions: Question[] = [
  { id: 'preview_reading', title: '你主要使用哪种设备阅读网页？', required: true,
    options: [{ value: 'computer', label: '电脑' }, { value: 'tablet', label: '平板' }, { value: 'phone', label: '手机' }] },
  { id: 'preview_frequency', title: '你使用在线对话助手的频率是？', required: true,
    options: [{ value: 'often', label: '经常使用' }, { value: 'sometimes', label: '偶尔使用' }, { value: 'never', label: '很少或从未使用' }] },
];
