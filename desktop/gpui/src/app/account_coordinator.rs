//! Source AccountMenu/AuthPanel presentation. This guest surface never creates
//! an account, imports remote writing, or interprets a prepared auth DTO as proof.
//! Registered auth and account-partition attachment remain separate host gates.
use super::*;
use gpui_kit::{Anchor, AnyElement};

pub(super) const SIGN_IN_UNAVAILABLE: &str =
    "Sign-in is not available in this desktop build yet. Your writing is saved on this device.";

impl WritingRoom {
    pub(super) fn account_menu(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *palette(cx);
        let trigger = gpui_kit::base::Button::new("account-menu")
            .track_focus(&self.account_focus)
            .accessibility_label("Open the editor's office (account)")
            .aria_expanded(self.account_open)
            .min_w(px(28.))
            .min_h(px(28.))
            .p(px(6.))
            .rounded(px(2.))
            .text_color(rgb(colors.ink_light))
            .hover(|style| {
                style
                    .text_color(rgb(colors.vermilion))
                    .bg(rgb(colors.sidebar))
            })
            .child(assets::icon(TwyneIcon::User).with_size(px(18.)));
        let content = self.account_menu_content(cx);
        gpui_kit::base::Popover::new("account-popover")
            .anchor(Anchor::TopRight)
            .offset(px(8.))
            .open(self.account_open)
            .on_open_change(cx.listener(|this, open, _, cx| {
                this.account_open = *open;
                cx.notify();
            }))
            .trigger_with(move |_, _, _| focus_outline(trigger, 1., 2., colors.vermilion))
            .content(move |_, _, _| content)
            .into_any_element()
    }

    fn account_menu_content(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = *palette(cx);
        let mut navigation = div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .pb(px(8.))
            .border_b_1()
            .border_color(rgb(colors.rule));
        for (id, label, icon) in [
            ("account-preferences", "Preferences", TwyneIcon::Settings),
            ("account-desk", "My Desk", TwyneIcon::House),
            ("account-manual", "The Manual", TwyneIcon::BookOpen),
            ("account-privacy", "Privacy ledger", TwyneIcon::ShieldCheck),
        ] {
            let row = gpui_kit::base::Button::new(id)
                .w_full()
                .justify_start()
                .gap(px(8.))
                .px(px(8.))
                .py(px(6.))
                .font_family(DISPLAY_FONT)
                .text_size(px(14.))
                .line_height(px(20.))
                .text_color(rgb(colors.ink))
                .accessibility_label(label)
                .hover(|style| style.text_color(rgb(colors.vermilion)))
                .child(assets::icon(icon))
                .child(label)
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.account_open = false;
                    match id {
                        "account-preferences" => this.open_settings(window, cx),
                        "account-desk" => this.open_house(window, cx),
                        // Native Manual/ledger routes are not ported yet. These
                        // explicit clicks open the existing Source destinations.
                        "account-manual" => cx.open_url("https://twyne.love/docs/"),
                        "account-privacy" => cx.open_url("https://twyne.love/privacy-ledger/"),
                        _ => unreachable!(),
                    }
                    cx.notify();
                }));
            navigation = navigation.child(focus_outline(row, 2., 0., colors.vermilion));
        }
        div()
            .id("account-panel")
            .test_support()
            .w(px(288.))
            .p(px(12.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .bg(rgb(colors.paper_soft))
            .border_1()
            .border_color(rgb(colors.rule))
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(0.), px(1.), rgb(colors.emboss).opacity(0.6).into())
                    .inset(),
                gpui_kit::BoxShadow::new(px(0.), px(14.), rgb(colors.shade).opacity(0.4).into())
                    .blur_radius(px(32.))
                    .spread_radius(px(-22.)),
                gpui_kit::BoxShadow::new(px(0.), px(2.), rgb(colors.shade).opacity(0.05).into()),
            ])
            .child(navigation)
            .child(
                div()
                    .id("account-auth-panel")
                    .test_support()
                    .p(px(20.))
                    .child(dept_label("The Editor's Office", cx))
                    .child(
                        div()
                            .mt(px(12.))
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(16.8))
                            .line_height(relative(1.375))
                            .text_color(rgb(colors.ink))
                            .child("Sign in with your Not Organic account."),
                    )
                    .child(
                        div()
                            .mt(px(4.))
                            .font_family(SERIF_FONT)
                            .italic()
                            .text_size(px(12.))
                            .line_height(px(20.))
                            .text_color(rgb(colors.ink_light))
                            .child("New here? You can create one on the next page. The same account holds your plan, your credit and your published writing."),
                    )
                    .when_some(self.account_error, |this, message| {
                        this.child(
                            div()
                                .id("account-error")
                                .test_support()
                                .mt(px(16.))
                                .p(px(10.))
                                .rounded(px(2.))
                                .border_1()
                                .border_color(rgb(colors.vermilion))
                                .bg(rgb(colors.paper))
                                .role(Role::Alert)
                                .aria_label("Setup needs attention")
                                .flex()
                                .items_start()
                                .gap(px(12.))
                                .child(div().font_family(DISPLAY_FONT).text_color(rgb(colors.vermilion)).child("!"))
                                .child(div().flex_1().min_w_0()
                                    .child(div().font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD)
                                        .text_size(px(12.)).line_height(px(16.)).child("Setup needs attention"))
                                    .child(div().mt(px(4.)).font_family(SERIF_FONT).text_size(px(11.2))
                                        .line_height(relative(1.625)).text_color(rgb(colors.ink_light)).child(message))),
                        )
                    })
                    .child(focus_outline(
                        crate::chrome::wrapping_press_button("account-sign-in", "Continue with Not Organic", 11.2, cx)
                            .w_full()
                            .mt(px(20.))
                            .on_click(cx.listener(|this, _, _, cx| {
                                // Never launch an unregistered sign-in or attach
                                // the device's guest library implicitly.
                                this.account_error = Some(SIGN_IN_UNAVAILABLE);
                                cx.notify();
                            })),
                        2., 2., colors.vermilion,
                    )),
            )
            .into_any_element()
    }
}
