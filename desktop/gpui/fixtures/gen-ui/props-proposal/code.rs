use serde_json::Value;
use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidationError;

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("invalid component props")
    }
}

impl Error for ValidationError {}

pub fn validate_component_props(
    component: &str,
    props: &Value,
) -> Result<(), ValidationError> {
    match component {
        "SentenceLab" => validate_sentence_lab(props),
        "RhythmStrip" => validate_rhythm_strip(props),
        "ClaimCheck" => validate_claim_check(props),
        "ReaderQuestions" => validate_reader_questions(props),
        _ => Err(ValidationError),
    }
}

fn string_length_in_range(value: &Value, min: usize, max: usize) -> bool {
    value.as_str().is_some_and(|text| {
        let length = text.encode_utf16().count();
        (min..=max).contains(&length)
    })
}

fn integer_in_range(value: &Value, min: f64, max: f64) -> bool {
    let Value::Number(number) = value else {
        return false;
    };
    number.as_f64().is_some_and(|number| {
        number.is_finite()
            && number.fract() == 0.0
            && number >= min
            && number <= max
    })
}

fn nonnegative_integer(value: &Value) -> bool {
    let Value::Number(number) = value else {
        return false;
    };
    number
        .as_f64()
        .is_some_and(|number| number.is_finite() && number.fract() == 0.0 && number >= 0.0)
}

fn validate_sentence_lab(props: &Value) -> Result<(), ValidationError> {
    let Some(props) = props.as_object() else {
        return Err(ValidationError);
    };
    if !props
        .get("sentence")
        .is_some_and(|value| string_length_in_range(value, 1, 1200))
    {
        return Err(ValidationError);
    }
    let Some(attempts) = props.get("attempts").and_then(Value::as_array) else {
        return Err(ValidationError);
    };
    if attempts.len() > 6
        || attempts
            .iter()
            .any(|value| !string_length_in_range(value, 0, 1200))
    {
        return Err(ValidationError);
    }
    let Some(variants) = props.get("variants").and_then(Value::as_array) else {
        return Err(ValidationError);
    };
    if variants.len() > 3
        || variants
            .iter()
            .any(|value| !string_length_in_range(value, 1, 1200))
    {
        return Err(ValidationError);
    }
    Ok(())
}

fn validate_rhythm_strip(props: &Value) -> Result<(), ValidationError> {
    let Some(props) = props.as_object() else {
        return Err(ValidationError);
    };
    let Some(sentences) = props.get("sentences").and_then(Value::as_array) else {
        return Err(ValidationError);
    };
    if !(1..=40).contains(&sentences.len()) {
        return Err(ValidationError);
    }
    for sentence in sentences {
        let Some(sentence) = sentence.as_object() else {
            return Err(ValidationError);
        };
        if !sentence.get("text").is_some_and(Value::is_string)
            || !sentence.get("words").is_some_and(nonnegative_integer)
        {
            return Err(ValidationError);
        }
    }
    if !props
        .get("targetMin")
        .is_some_and(|value| integer_in_range(value, 1.0, 80.0))
        || !props
            .get("targetMax")
            .is_some_and(|value| integer_in_range(value, 2.0, 120.0))
    {
        return Err(ValidationError);
    }
    Ok(())
}

fn validate_claim_check(props: &Value) -> Result<(), ValidationError> {
    let Some(props) = props.as_object() else {
        return Err(ValidationError);
    };
    if !props
        .get("claim")
        .is_some_and(|value| string_length_in_range(value, 1, 1200))
    {
        return Err(ValidationError);
    }
    let Some(slots) = props.get("slots").and_then(Value::as_array) else {
        return Err(ValidationError);
    };
    if !(1..=5).contains(&slots.len()) {
        return Err(ValidationError);
    }
    for slot in slots {
        let Some(slot) = slot.as_object() else {
            return Err(ValidationError);
        };
        if !slot
            .get("label")
            .is_some_and(|value| string_length_in_range(value, 1, 60))
            || !slot.get("filled").is_some_and(Value::is_boolean)
        {
            return Err(ValidationError);
        }
    }
    Ok(())
}

fn validate_reader_questions(props: &Value) -> Result<(), ValidationError> {
    let Some(props) = props.as_object() else {
        return Err(ValidationError);
    };
    if !props
        .get("angle")
        .is_some_and(|value| string_length_in_range(value, 0, 200))
    {
        return Err(ValidationError);
    }
    let Some(questions) = props.get("questions").and_then(Value::as_array) else {
        return Err(ValidationError);
    };
    if questions.len() > 4
        || questions
            .iter()
            .any(|value| !string_length_in_range(value, 3, 240))
    {
        return Err(ValidationError);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ValidationError, validate_component_props};
    use serde_json::{Value, json};
    use std::error::Error;

    fn assert_valid(component: &str, props: Value) {
        assert!(validate_component_props(component, &props).is_ok());
    }

    fn assert_invalid(component: &str, props: Value) {
        assert_eq!(validate_component_props(component, &props), Err(ValidationError));
    }

    #[test]
    fn accepts_each_catalog_component() {
        assert_valid(
            "SentenceLab",
            json!({"sentence":"A sentence.","attempts":[],"variants":["Another sentence."]}),
        );
        assert_valid(
            "RhythmStrip",
            json!({"sentences":[{"text":"A sentence.","words":3}],"targetMin":8,"targetMax":28}),
        );
        assert_valid(
            "ClaimCheck",
            json!({"claim":"A claim.","slots":[{"label":"Evidence","filled":false}]}),
        );
        assert_valid(
            "ReaderQuestions",
            json!({"angle":"","questions":["Why now?"]}),
        );
    }

    #[test]
    fn sentence_lab_enforces_limits_and_asymmetric_empty_strings() {
        assert_valid(
            "SentenceLab",
            json!({"sentence":"x","attempts":["","a".repeat(1200)],"variants":["v".repeat(1200)]}),
        );
        assert_invalid(
            "SentenceLab",
            json!({"sentence":"x","attempts":["x"; 7],"variants":[]}),
        );
        assert_invalid(
            "SentenceLab",
            json!({"sentence":"x","attempts":[],"variants":[""]}),
        );
        assert_invalid(
            "SentenceLab",
            json!({"sentence":"s".repeat(1201),"attempts":[],"variants":[]}),
        );
    }

    #[test]
    fn string_boundaries_count_utf16_code_units() {
        let sentence = "😀".repeat(600);
        assert_valid(
            "SentenceLab",
            json!({"sentence":sentence,"attempts":[],"variants":[]}),
        );
        assert_invalid(
            "SentenceLab",
            json!({"sentence":"😀".repeat(601),"attempts":[],"variants":[]}),
        );
        assert_valid(
            "ClaimCheck",
            json!({"claim":"😀".repeat(600),"slots":[{"label":"😀".repeat(30),"filled":true}]}),
        );
        assert_invalid(
            "ClaimCheck",
            json!({"claim":"x","slots":[{"label":"😀".repeat(31),"filled":true}]}),
        );
        assert_valid(
            "ReaderQuestions",
            json!({"angle":"😀".repeat(100),"questions":["😀".repeat(120)]}),
        );
        assert_invalid(
            "ReaderQuestions",
            json!({"angle":"😀".repeat(101),"questions":[]}),
        );
        assert_invalid(
            "ReaderQuestions",
            json!({"angle":"","questions":["😀".repeat(121)]}),
        );
    }

    #[test]
    fn rhythm_strip_accepts_integral_float_notation_without_cross_field_rules() {
        assert_valid(
            "RhythmStrip",
            json!({"sentences":[{"text":"","words":1e0}],"targetMin":1.0,"targetMax":2e0}),
        );
        assert_valid(
            "RhythmStrip",
            json!({"sentences":[{"text":"","words":0}],"targetMin":80,"targetMax":2}),
        );
    }

    #[test]
    fn rhythm_strip_enforces_array_bounds_and_nested_types() {
        let forty = vec![json!({"text":"","words":0}); 40];
        assert_valid(
            "RhythmStrip",
            json!({"sentences":forty,"targetMin":1,"targetMax":2}),
        );
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":[],"targetMin":1,"targetMax":2}),
        );
        let forty_one = vec![json!({"text":"","words":0}); 41];
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":forty_one,"targetMin":1,"targetMax":2}),
        );
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":[{"text":false,"words":0}],"targetMin":1,"targetMax":2}),
        );
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":[{"text":"x","words":-1}],"targetMin":1,"targetMax":2}),
        );
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":[{"text":"x","words":0}],"targetMin":0,"targetMax":2}),
        );
    }

    #[test]
    fn claim_check_enforces_slot_count_and_fields() {
        let five = vec![json!({"label":"x","filled":false}); 5];
        assert_valid("ClaimCheck", json!({"claim":"x","slots":five}));
        assert_invalid("ClaimCheck", json!({"claim":"x","slots":[]}));
        let six = vec![json!({"label":"x","filled":false}); 6];
        assert_invalid("ClaimCheck", json!({"claim":"x","slots":six}));
        assert_invalid(
            "ClaimCheck",
            json!({"claim":"x","slots":[{"label":"","filled":false}]}),
        );
        assert_invalid(
            "ClaimCheck",
            json!({"claim":"x","slots":[{"label":"x","filled":"false"}]}),
        );
    }

    #[test]
    fn reader_questions_allows_empty_angle_and_enforces_question_limits() {
        assert_valid("ReaderQuestions", json!({"angle":"","questions":[]}));
        assert_valid(
            "ReaderQuestions",
            json!({"angle":"a","questions":["one","two","three","four"]}),
        );
        assert_invalid(
            "ReaderQuestions",
            json!({"angle":"a","questions":["one","two","three","four","five"]}),
        );
        assert_invalid(
            "ReaderQuestions",
            json!({"angle":"a","questions":["no"]}),
        );
        assert_invalid(
            "ReaderQuestions",
            json!({"angle":null,"questions":[]}),
        );
    }

    #[test]
    fn unknown_metadata_is_tolerated_without_mutating_input() {
        let props = json!({
            "sentence":"A sentence.",
            "attempts":[],
            "variants":[],
            "metadata":{"source":"private-sentinel"},
            "nested":{"extra":[1,2,3]}
        });
        let original = props.clone();
        assert_valid("SentenceLab", props.clone());
        assert_eq!(props, original);
    }

    #[test]
    fn missing_null_and_wrongly_typed_required_fields_fail() {
        assert_invalid("SentenceLab", json!({"sentence":"x","attempts":[]}));
        assert_invalid("SentenceLab", Value::Null);
        assert_invalid(
            "RhythmStrip",
            json!({"sentences":[{"text":"x","words":null}],"targetMin":1,"targetMax":2}),
        );
        assert_invalid(
            "ClaimCheck",
            json!({"claim":null,"slots":[{"label":"x","filled":true}]}),
        );
        assert_invalid("ReaderQuestions", json!({"angle":"x","questions":null}));
    }

    #[test]
    fn only_exact_catalog_names_are_accepted_and_errors_do_not_echo_input() {
        let props = json!({"secret":"private-sentinel"});
        let error = validate_component_props("private-sentinel", &props).unwrap_err();
        let rendered = error.to_string();
        assert!(!rendered.contains("private-sentinel"));
        assert_eq!(error, ValidationError);
        assert!(error.source().is_none());
        assert_invalid("sentence-lab", json!({}));
    }

    #[test]
    fn word_counts_have_no_safe_integer_limit() {
        assert_valid(
            "RhythmStrip",
            json!({
                "sentences":[
                    {"text":"x","words":u64::MAX},
                    {"text":"y","words":1e100}
                ],
                "targetMin":1,
                "targetMax":2
            }),
        );
    }
}
