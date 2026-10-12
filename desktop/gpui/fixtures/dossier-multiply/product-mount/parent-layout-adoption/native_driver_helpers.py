"""Unapplied pure predicates inserted into the existing native proof driver.

No native/window/atlas operation is performed by these helpers. Synthetic tests
exercise observation validation, never create a successful native receipt.
The original driver's require() is supplied by the insertion context.
"""


def observed_foxing(lifecycle):
    foxing = lifecycle.get("foxing")
    require(isinstance(foxing, dict), "Reviewed product foxing observation hook is absent")
    require(isinstance(foxing.get("supportsDestinationMultiply"), bool),
            "Backend support must be an actual Window observation")
    require(isinstance(foxing.get("prepared"), bool), "Missing actual preparation observation")
    return foxing


def prepared_mount_ready(state, expected_support):
    lifecycle = state["dossierImageLifecycle"]
    foxing = observed_foxing(lifecycle)
    if lifecycle["invalidationQueued"] or lifecycle["pendingCount"] != 0 or not foxing["prepared"]:
        return False
    require(isinstance(foxing.get("transparent"), bool), "Missing prepared transparency observation")
    if expected_support != "any":
        require(foxing["supportsDestinationMultiply"] is (expected_support == "supported"),
                "Actual backend support differs from the requested native proof lane")
    viewport = state["viewport"]
    if foxing["logicalWidth"] != viewport["width"] or foxing["logicalHeight"] != viewport["height"] \
            or foxing["scaleFactor"] != state["scaleFactor"]:
        return False
    images = image_map(lifecycle)
    identifier = foxing.get("imageId")
    if foxing["transparent"]:
        require(identifier is None, "Transparent preparation must not own a group image")
        if foxing["paintStatus"] != "Transparent":
            return False
    else:
        require(isinstance(identifier, str) and identifier, "Nontransparent preparation must expose its exact image ID")
        if identifier not in images or not images[identifier]["active"]:
            return False
        if foxing["supportsDestinationMultiply"]:
            if foxing["paintStatus"] != "Recorded" or not images[identifier]["atlasPresent"]:
                return False
        else:
            if foxing["paintStatus"] != "UnsupportedBackend":
                return False
            require(not images[identifier]["atlasPresent"],
                    "Unsupported product backend must not upload its premultiplied group")
    ordinary = {key: value for key, value in images.items() if key != identifier}
    # This REAL native lane never relaxes the original-font stamp gate.
    # Default NoopTextSystem test preparation is not admitted here.
    return len(ordinary) == 9 and lifecycle["activeCount"] == 9 + int(identifier is not None) \
        and all(image["active"] for image in ordinary.values()) \
        and sum(image["atlasPresent"] for image in ordinary.values()) >= 2


def expected_uploaded_ids(lifecycle):
    foxing = observed_foxing(lifecycle)
    identifiers = set(image_map(lifecycle))
    # Call only after the original real navigation uploads ALL eight stamp
    # variants. Before that, this is an expectation, not an upload observation.
    if not foxing["supportsDestinationMultiply"] and foxing.get("imageId") is not None:
        identifiers.remove(foxing["imageId"])
    return identifiers


def uploaded_ids(lifecycle):
    return {identifier for identifier, image in image_map(lifecycle).items() if image["atlasPresent"]}
