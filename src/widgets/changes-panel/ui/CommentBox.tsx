import { useState } from 'react';
import { Button, Textarea } from '@design-system/react';
import { useT } from '@/shared/i18n';

/** Editor under a diff line: ⌘Enter adds, Esc cancels. */
export function CommentEditor({ onAdd, onCancel }: { onAdd: (text: string) => void; onCancel: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const add = () => text.trim() && onAdd(text);
  return (
    <div className="c-diff__comment" onClick={(e) => e.stopPropagation()}>
      <Textarea
        autoFocus
        value={text}
        placeholder={t('changes.comment.placeholder')}
        aria-label={t('changes.comment.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="c-diff__comment-actions">
        <Button variant="ghost" onClick={onCancel}>
          {t('action.cancel')}
        </Button>
        <Button variant="primary" onClick={add} disabled={!text.trim()}>
          {t('action.add')}
        </Button>
      </div>
    </div>
  );
}

/** A saved comment under its line. */
export function CommentNote({ text, onRemove }: { text: string; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="c-diff__comment">
      <span>{text}</span>
      <div className="c-diff__comment-actions">
        <Button variant="ghost" onClick={onRemove}>
          {t('changes.comment.remove')}
        </Button>
      </div>
    </div>
  );
}
