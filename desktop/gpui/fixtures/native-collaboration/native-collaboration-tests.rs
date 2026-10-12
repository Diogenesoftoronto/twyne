//! Crate tests consumed by native_collaboration::tests. Not a standalone rustc harness.
//! Expected strings come from execution of unchanged original Source functions.
use super::*;
use serde_json::{Value, json};

fn reference() -> Value {
    serde_json::from_str(include_str!("source-reference.json"))
        .expect("retained Source observations")
}
fn text<'a>(row: &'a Value, key: &str) -> &'a str {
    row[key].as_str().expect("string fixture field")
}
fn rows<'a>(reference: &'a Value, key: &str) -> &'a [Value] {
    reference[key].as_array().expect("fixture cases")
}

#[test]
fn original_color_and_private_label_vectors() {
    let source = reference();
    for row in rows(&source, "colors") {
        assert_eq!(pick_presence_color(text(row, "userId")), text(row, "color"));
    }
    for row in rows(&source, "names") {
        assert_eq!(
            account_name(Some(text(row, "input"))),
            row["name"].as_str(),
            "{row}"
        );
        assert_eq!(
            account_initials(text(row, "input")),
            text(row, "initials"),
            "{row}"
        );
    }
    for row in rows(&source, "displays") {
        assert_eq!(
            account_display_name(
                row["user"]["name"].as_str(),
                row["user"]["handle"].as_str(),
                row["profile"]["displayName"].as_str(),
                row["profile"]["handle"].as_str()
            ),
            text(row, "displayName")
        );
    }
    let metadata = WriterMetadata::new(
        "caller-label",
        "Name private@example.com",
        Some("contact@example.com".into()),
        true,
    )
    .unwrap();
    assert_eq!(metadata.display_name, "Writer");
    assert!(!format!("{metadata:?}").contains("contact@example.com"));
    assert_eq!(
        metadata.private_contact_email.as_deref(),
        Some("contact@example.com")
    );
    assert!(WriterMetadata::new("\u{feff} \u{feff}", "Poet", None, true).is_err());
}

#[test]
fn original_slug_and_server_string_strip_vectors_preserve_unicode_and_malformed_tags() {
    let source = reference();
    for row in rows(&source, "slugs") {
        assert_eq!(slugify(text(row, "input")), text(row, "output"), "{row}");
    }
    for row in rows(&source, "sanitizer") {
        assert_eq!(
            sanitize_html(text(row, "input")),
            text(row, "output"),
            "{row}"
        );
    }
}

#[test]
fn original_atproto_route_validation_and_single_slash_origin_projection() {
    let source = reference();
    for row in rows(&source, "dids") {
        assert_eq!(
            is_atproto_did(text(row, "input")),
            row["valid"].as_bool().unwrap(),
            "{row}"
        );
    }
    for row in rows(&source, "tids") {
        assert_eq!(
            is_tid(text(row, "input")),
            row["valid"].as_bool().unwrap(),
            "{row}"
        );
    }
    for row in rows(&source, "uris") {
        let parsed = parse_at_uri(text(row, "input"))
            .map(|p| json!({"did": p.did, "collection": p.collection, "rkey": p.rkey}));
        assert_eq!(
            parsed,
            (!row["parsed"].is_null()).then(|| row["parsed"].clone()),
            "{row}"
        );
    }
    for row in rows(&source, "urls") {
        assert_eq!(
            standard_site_publication_url(
                "did:web:example.com",
                "3k2vknq6z3p46",
                Some(text(row, "origin"))
            )
            .unwrap(),
            text(row, "publication")
        );
        assert_eq!(
            standard_site_document_url(
                "did:web:example.com",
                "3k2vknq6z3p46",
                "3k2vknq6z3p47",
                Some(text(row, "origin"))
            )
            .unwrap(),
            text(row, "document")
        );
    }
}

#[test]
fn original_parsed_micropub_hostname_and_urlsearchparams_body_vectors() {
    let source = reference();
    for row in rows(&source, "micropubEndpoints") {
        let actual = validate_micropub_endpoint(text(row, "input"));
        assert_eq!(actual.is_ok(), row["ok"].as_bool().unwrap(), "{row}");
        if let Ok(value) = actual {
            assert_eq!(value, text(row, "value"), "{row}");
        }
    }
    for row in rows(&source, "micropubForms") {
        assert_eq!(
            format_micropub_body(text(row, "title"), text(row, "html")),
            text(row, "body"),
            "{row}"
        );
    }
}

#[test]
fn typed_wire_dtos_serialize_without_a_nonexistent_serde_feature() {
    let raw = json!({"userId":"peer", "displayName":"Name private@example.com", "color":"#c1272d",
        "cursorPos":3.5, "selectionAnchor":-1.0, "selectionHead":6.0, "lastSeenAt":100000});
    let peer: PresenceUser = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(peer.cursor_pos, Some(ProseMirrorPosition(3.5)));
    assert_eq!(serde_json::to_value(&peer).unwrap(), raw);
    assert!(serde_json::from_value::<PresenceUser>(json!({"userId":"peer", "displayName":"Poet", "color":"red", "cursorPos":"3", "lastSeenAt":0})).is_err());
    let row: Collaborator = serde_json::from_value(
        json!({"userId":"label", "role":"owner", "status":"pending", "invitedAt":0}),
    )
    .unwrap();
    assert_eq!(row.accepted_role(), None);
    let accepted: Collaborator = serde_json::from_value(
        json!({"userId":"label", "role":"commenter", "status":"accepted", "invitedAt":0}),
    )
    .unwrap();
    assert_eq!(accepted.accepted_role(), Some(CollaboratorRole::Commenter));
    let receipt_raw = json!({"slug":"piece", "ownerHandle":null, "updated":false, "kind":"post", "requestedBlog":true, "future":{"keep":[1,null]}});
    let receipt: ConvexPublishReceipt = serde_json::from_value(receipt_raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(&receipt).unwrap(), receipt_raw);
    // A DTO label is not authentication or publication evidence.
    assert_eq!(
        receipt.reader_url("https://reader.example"),
        "https://reader.example/p/piece"
    );
}

#[test]
fn wire_roster_uses_pm_tree_bounds_and_safe_public_labels_without_scalar_conversion() {
    let source = reference();
    let content_size = source["pm"]["contentSize"].as_u64().unwrap() as usize;
    assert_ne!(
        content_size,
        source["pm"]["textScalarCount"].as_u64().unwrap() as usize
    );
    let mut roster = DocumentPresenceRoster::new();
    let now = 100_000;
    roster.record_heartbeat(
        "local",
        "Local",
        Some(ProseMirrorPosition(2.0)),
        None,
        None,
        now,
    );
    roster.record_heartbeat(
        "peer",
        "Name private@example.com",
        Some(ProseMirrorPosition(999.0)),
        Some(ProseMirrorPosition(-2.0)),
        Some(ProseMirrorPosition(99.0)),
        now,
    );
    roster.record_heartbeat("stale", "Stale", None, None, None, now - 30_001);
    roster.record_heartbeat(
        "boundary",
        "Poet",
        Some(ProseMirrorPosition(-1.0)),
        None,
        None,
        now - 30_000,
    );
    let projected =
        roster.generate_remote_cursors(ProseMirrorContentSize(content_size), Some("local"), now);
    assert_eq!(projected.len(), 2);
    assert_eq!(projected[0].user_id, "boundary");
    assert_eq!(projected[0].cursor_pos, None);
    assert_eq!(projected[1].display_name, "Writer");
    assert_eq!(
        projected[1].cursor_pos,
        Some(ProseMirrorPosition((content_size + 1) as f64))
    );
    assert_eq!(
        projected[1].selection_range,
        Some((
            ProseMirrorPosition(0.0),
            ProseMirrorPosition(content_size as f64)
        ))
    );
    // Roster projection does not map Source transactions or paint a native overlay.
    let mut nonfinite = PresenceUser::new("nonfinite", "Poet", now);
    nonfinite.cursor_pos = Some(ProseMirrorPosition(f64::NAN));
    roster.update_peer(nonfinite);
    assert_eq!(
        roster
            .generate_remote_cursors(ProseMirrorContentSize(content_size), None, now)
            .iter()
            .find(|p| p.user_id == "nonfinite")
            .unwrap()
            .cursor_pos,
        None
    );
}

#[test]
fn source_membership_vectors_separate_accepted_role_policy_from_authentication() {
    let source = reference();
    for row in rows(&source, "roles") {
        let role = CollaboratorRole::parse(text(row, "role")).unwrap();
        let status = CollaboratorStatus::parse(text(row, "status")).unwrap();
        let allowed = row["allowed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str() == Some(role.as_str()));
        assert_eq!(
            status.is_active_participant() && allowed,
            row["observed"]["ok"].as_bool().unwrap()
        );
    }
    assert_eq!(
        validate_removal(CollaboratorRole::Owner, CollaboratorRole::Owner),
        Err(CollaborationError::OwnerCannotBeModified)
    );
    assert!(
        validate_role_update(
            CollaboratorRole::Commenter,
            CollaboratorRole::Editor,
            CollaboratorRole::Commenter
        )
        .is_err()
    );
    assert!(
        validate_role_update(
            CollaboratorRole::Owner,
            CollaboratorRole::Editor,
            CollaboratorRole::Owner
        )
        .is_err()
    );
    assert_eq!(
        validate_invitation(
            CollaboratorRole::Owner,
            true,
            "\u{feff} PERSON@EXAMPLE.COM \u{feff}",
            CollaboratorRole::Editor
        )
        .unwrap(),
        "person@example.com"
    );
    assert_eq!(
        validate_invitation(
            CollaboratorRole::Owner,
            false,
            "person@example.com",
            CollaboratorRole::Editor
        ),
        Err(CollaborationError::ProRequired)
    );
}

#[test]
fn request_previews_preserve_authored_fields_and_remote_observations_do_not_commit() {
    let metadata = WriterMetadata::new("caller", "Poet", None, true).unwrap();
    let plan = prepare_promote_folio(
        &metadata,
        " exact-folio ",
        " Name ",
        "",
        "lix-exact",
        "https://server.example/",
    )
    .unwrap();
    assert_eq!(plan.folio_id, " exact-folio ");
    assert_eq!(plan.folio_name, " Name ");
    assert_eq!(plan.server_url, "https://server.example//lsp");
    assert!(plan.draft_html.is_empty()); // Source readiness checks absent, not blank HTML.
    let title = format!(" {}😀 ", "a".repeat(199));
    let publication = prepare_convex_publish(
        " exact-folio ",
        &title,
        Some(" Author "),
        Some(" Summary "),
        "<p onclick=x>東京</p>",
        Some(PublishKind::Blog),
    );
    assert_eq!(publication.title, title); // Do not approximate server UTF16 slicing.
    assert_eq!(publication.author_name.as_deref(), Some(" Author "));
    assert_eq!(publication.content, "<p onclick=x>東京</p>");
    assert_eq!(publication.kind, Some(PublishKind::Blog)); // Server alone resolves privileges.
    let mut observation = SharedSession::new(
        "lix",
        "folio",
        "Name",
        "https://server/lsp",
        CollaboratorRole::Commenter,
    );
    assert!(
        observation
            .observe_remote_snapshot("<p>remote</p>", Some("authored Source"))
            .is_some()
    );
    assert!(
        observation
            .observe_remote_snapshot("<p>remote</p>", Some("authored Source"))
            .is_none()
    );
    assert_eq!(observation.folio_id, "folio");
}

#[test]
fn every_offline_operation_refuses_success_even_with_all_requested_flags_true() {
    let writer = WriterMetadata::new("caller-label", "Writer", None, true).unwrap();
    let transport = OfflineLoopbackTransport::new(true, true);
    let plan = prepare_promote_folio(
        &writer,
        "folio",
        "Name",
        "<p>東京</p>",
        "lix",
        "https://server",
    )
    .unwrap();
    let invite = prepare_invitation(
        &writer,
        CollaboratorRole::Owner,
        "lix",
        "Name",
        "synthetic@example.com",
        CollaboratorRole::Editor,
    )
    .unwrap();
    let publish = prepare_convex_publish("folio", "Name", None, None, "<p>東京</p>", None);
    let attempts = [
        transport.promote_folio(&writer, &plan).map(|_| ()),
        transport.invite_collaborator(&writer, &invite).map(|_| ()),
        transport
            .remove_collaborator(&writer, CollaboratorRole::Owner, CollaboratorRole::Editor)
            .map(|_| ()),
        transport
            .update_role(
                &writer,
                CollaboratorRole::Owner,
                CollaboratorRole::Editor,
                CollaboratorRole::Commenter,
            )
            .map(|_| ()),
        transport.send_heartbeat(
            &writer,
            "lix",
            Some(ProseMirrorPosition(2.0)),
            None,
            None,
            0,
        ),
        transport.unshare_folio(&writer, CollaboratorRole::Owner, "lix"),
        transport
            .publish_convex(&writer, &publish, "slug", None, "https://reader")
            .map(|_| ()),
        transport
            .publish_atproto(
                &writer,
                "did:plc:abc",
                "3k2vknq6z3p46",
                "3k2vknq6z3p47",
                None,
            )
            .map(|_| ()),
        transport
            .publish_micropub(
                "https://writer.example",
                "fixture-only",
                "Title",
                "<p>東京</p>",
            )
            .map(|_| ()),
    ];
    for attempt in attempts {
        assert!(matches!(
            attempt,
            Err(CollaborationError::CapabilityUnavailable { .. })
        ));
    }
    assert_eq!(plan.draft_html, "<p>東京</p>");
    assert!(matches!(
        OfflineLoopbackTransport::new(false, true).promote_folio(&writer, &plan),
        Err(CollaborationError::AuthRequired(_))
    ));
    assert!(matches!(
        OfflineLoopbackTransport::new(true, false).promote_folio(&writer, &plan),
        Err(CollaborationError::OfflineBeforeNetwork { .. })
    ));
    let mut cancelled = transport.clone();
    cancelled.is_cancelled = true;
    assert_eq!(
        cancelled.promote_folio(&writer, &plan),
        Err(CollaborationError::Cancelled)
    );
    assert!(matches!(
        transport.publish_micropub(
            "https://writer.example",
            "\u{feff} \u{feff}",
            "Title",
            "body"
        ),
        Err(CollaborationError::MissingToken(_))
    ));
    assert!(matches!(
        transport.publish_micropub("http://localhost.evil", "fixture-only", "Title", "body"),
        Err(CollaborationError::InsecureMicropubEndpoint(_))
    ));
}
