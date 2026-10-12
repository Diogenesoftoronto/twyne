//! Registry keyboard bindings for the structural commands shown in slash hints.
use super::*;
use crate::editor::{BlockObject, ListKind};
use gpui_kit::InteractiveElement;

gpui_kit::actions!(
    twyne_editor_commands,
    [
        HeadingOne,
        HeadingTwo,
        HeadingThree,
        BulletList,
        NumberedList,
        PullQuote,
        CodeBlock,
        PageBreak
    ]
);

pub(super) fn init(cx: &mut App) {
    #[cfg(target_os = "macos")]
    let primary = "cmd";
    #[cfg(not(target_os = "macos"))]
    let primary = "ctrl";
    macro_rules! bind {
        ($id:literal, $action:ident) => {
            if let Some(chord) = crate::insert_menu::commands()
                .iter()
                .find(|command| command.id == $id)
                .and_then(|command| command.keybinding.as_ref())
            {
                let chord = chord.replace("Mod", primary).to_ascii_lowercase();
                cx.bind_keys([KeyBinding::new(&chord, $action, Some(EDITOR_KEY_CONTEXT))]);
            }
        };
    }
    bind!("paragraph.heading-1", HeadingOne);
    bind!("paragraph.heading-2", HeadingTwo);
    bind!("paragraph.heading-3", HeadingThree);
    bind!("paragraph.bullet-list", BulletList);
    bind!("paragraph.numbered-list", NumberedList);
    bind!("paragraph.blockquote", PullQuote);
    bind!("paragraph.code-block", CodeBlock);
    bind!("insert.page-break", PageBreak);
}

impl RichEditorView {
    pub(super) fn shortcut_handlers<E: InteractiveElement>(
        &self,
        element: E,
        cx: &mut Context<Self>,
    ) -> E {
        element
            .on_action(cx.listener(|this, _: &HeadingOne, window, cx| {
                this.run_shortcut(Command::SetHeading(1), window, cx)
            }))
            .on_action(cx.listener(|this, _: &HeadingTwo, window, cx| {
                this.run_shortcut(Command::SetHeading(2), window, cx)
            }))
            .on_action(cx.listener(|this, _: &HeadingThree, window, cx| {
                this.run_shortcut(Command::SetHeading(3), window, cx)
            }))
            .on_action(cx.listener(|this, _: &BulletList, window, cx| {
                this.run_shortcut(Command::ToggleList(ListKind::Bullet), window, cx)
            }))
            .on_action(cx.listener(|this, _: &NumberedList, window, cx| {
                this.run_shortcut(Command::ToggleList(ListKind::Ordered), window, cx)
            }))
            .on_action(cx.listener(|this, _: &PullQuote, window, cx| {
                this.run_shortcut(Command::ToggleBlockQuote, window, cx)
            }))
            .on_action(cx.listener(|this, _: &CodeBlock, window, cx| {
                this.run_shortcut(Command::ToggleCodeBlock, window, cx)
            }))
            .on_action(cx.listener(|this, _: &PageBreak, window, cx| {
                this.run_page_break_shortcut(window, cx)
            }))
    }
    fn run_shortcut(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_composing() {
            cx.propagate();
            return;
        }
        let _ = self.execute(command, window, cx);
    }
    fn run_page_break_shortcut(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_composing() {
            cx.propagate();
            return;
        }
        if let Ok(outcome) = self.execute(Command::ExitCodeBlock, window, cx)
            && !outcome.document_changed
        {
            let _ = self.execute(Command::InsertBlock(BlockObject::PageBreak), window, cx);
        }
    }
}
