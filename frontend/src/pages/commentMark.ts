import { Mark, mergeAttributes } from '@tiptap/core';

// An inline mark that anchors a collaborative comment to a span of text. The
// `commentId` matches a DocComment row (and the WS `comment.*` frames) so the
// sidebar and the highlighted text stay in sync. The mark is serialized into
// the document HTML, so it persists through the normal content autosave.
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: 'comment',
  // Comments can overlap other formatting; keep them inclusive-exclusive so
  // typing at the boundary doesn't accidentally extend the highlight.
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'doc-comment' }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),
      unsetComment:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

// Remove every span carrying `commentId` from the document. Used when a comment
// is deleted (locally or via a remote `comment.deleted` frame). Operates through
// a single transaction so it's one undo step.
export function removeCommentMark(
  editor: { state: import('@tiptap/pm/state').EditorState; view: import('@tiptap/pm/view').EditorView },
  commentId: string,
): void {
  const markType = editor.state.schema.marks.comment;
  if (!markType) return;
  const { tr, doc } = { tr: editor.state.tr, doc: editor.state.doc };
  let changed = false;
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (m) => m.type === markType && m.attrs.commentId === commentId,
    );
    if (mark) {
      tr.removeMark(pos, pos + node.nodeSize, markType);
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}
