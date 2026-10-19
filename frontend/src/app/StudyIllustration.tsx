const assets = {
  reading: 'reading-watercolor.webp',
  tasks: 'task-folder-watercolor.webp',
  profile: 'filed-notes-watercolor.webp',
};

export function StudyIllustration({ variant, className = '' }: { variant: keyof typeof assets; className?: string }) {
  return <img className={`study-illustration ${className}`} src={`${import.meta.env.BASE_URL}illustrations/${assets[variant]}`}
    alt="" aria-hidden="true" width="1536" height="1024" decoding="async" draggable={false} />;
}
