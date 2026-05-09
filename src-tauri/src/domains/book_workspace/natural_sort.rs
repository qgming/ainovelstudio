use std::cmp::Ordering;

#[derive(Debug, Eq, PartialEq)]
enum NameSortSegment {
    Number { raw: String, value: u128 },
    Text(String),
}

pub(crate) fn natural_name_cmp(left: &str, right: &str) -> Ordering {
    let left_segments = natural_name_segments(left);
    let right_segments = natural_name_segments(right);
    for (left_segment, right_segment) in left_segments.iter().zip(right_segments.iter()) {
        let ordering = compare_name_segment(left_segment, right_segment);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left_segments
        .len()
        .cmp(&right_segments.len())
        .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
}

fn compare_name_segment(left: &NameSortSegment, right: &NameSortSegment) -> Ordering {
    match (left, right) {
        (
            NameSortSegment::Number {
                raw: left_raw,
                value: left_value,
            },
            NameSortSegment::Number {
                raw: right_raw,
                value: right_value,
            },
        ) => left_value
            .cmp(right_value)
            .then_with(|| left_raw.chars().count().cmp(&right_raw.chars().count()))
            .then_with(|| left_raw.cmp(right_raw)),
        (NameSortSegment::Text(left_text), NameSortSegment::Text(right_text)) => {
            left_text.cmp(right_text)
        }
        _ => segment_raw_text(left).cmp(&segment_raw_text(right)),
    }
}

fn segment_raw_text(segment: &NameSortSegment) -> String {
    match segment {
        NameSortSegment::Number { raw, .. } => raw.clone(),
        NameSortSegment::Text(text) => text.clone(),
    }
}

fn natural_name_segments(value: &str) -> Vec<NameSortSegment> {
    let mut segments = Vec::new();
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let start = index;
        let is_ascii_number = chars[index].is_ascii_digit();
        let is_chinese_number = is_chinese_number_char(chars[index]);
        index += 1;
        while index < chars.len()
            && chars[index].is_ascii_digit() == is_ascii_number
            && is_chinese_number_char(chars[index]) == is_chinese_number
        {
            index += 1;
        }
        let raw = chars[start..index].iter().collect::<String>();
        segments.push(build_name_segment(raw, is_ascii_number, is_chinese_number));
    }
    segments
}

fn build_name_segment(
    raw: String,
    is_ascii_number: bool,
    is_chinese_number: bool,
) -> NameSortSegment {
    if is_ascii_number {
        return NameSortSegment::Number {
            value: raw.parse::<u128>().unwrap_or(u128::MAX),
            raw,
        };
    }
    if is_chinese_number {
        if let Some(value) = parse_chinese_number(&raw) {
            return NameSortSegment::Number { raw, value };
        }
    }
    NameSortSegment::Text(raw.to_lowercase())
}

fn is_chinese_number_char(value: char) -> bool {
    matches!(
        value,
        '零' | '〇'
            | '一'
            | '二'
            | '两'
            | '三'
            | '四'
            | '五'
            | '六'
            | '七'
            | '八'
            | '九'
            | '十'
            | '百'
            | '千'
            | '万'
            | '亿'
    )
}

fn chinese_digit_value(value: char) -> Option<u128> {
    match value {
        '零' | '〇' => Some(0),
        '一' => Some(1),
        '二' | '两' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn chinese_unit_value(value: char) -> Option<u128> {
    match value {
        '十' => Some(10),
        '百' => Some(100),
        '千' => Some(1_000),
        '万' => Some(10_000),
        '亿' => Some(100_000_000),
        _ => None,
    }
}

fn parse_chinese_digit_sequence(value: &str) -> Option<u128> {
    let mut parsed = 0;
    for digit in value.chars().map(chinese_digit_value) {
        parsed = parsed * 10 + digit?;
    }
    Some(parsed)
}

fn parse_chinese_number(value: &str) -> Option<u128> {
    if value
        .chars()
        .all(|character| chinese_digit_value(character).is_some())
    {
        return parse_chinese_digit_sequence(value);
    }
    let (mut total, mut section, mut digit) = (0, 0, 0);
    for character in value.chars() {
        if let Some(next_digit) = chinese_digit_value(character) {
            digit = next_digit;
            continue;
        }
        let unit = chinese_unit_value(character)?;
        if unit < 10_000 {
            section += digit.max(1) * unit;
        } else {
            total += (section + digit) * unit;
            section = 0;
        }
        digit = 0;
    }
    Some(total + section + digit)
}

#[cfg(test)]
mod tests {
    use super::natural_name_cmp;

    fn sorted_names(values: &[&str]) -> Vec<String> {
        let mut names = values
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>();
        names.sort_by(|left, right| natural_name_cmp(left, right));
        names
    }

    #[test]
    fn natural_name_cmp_sorts_arabic_numbers_by_value() {
        assert_eq!(
            sorted_names(&[
                "第1章.md",
                "第11章.md",
                "第123章.md",
                "第2章.md",
                "第3章.md"
            ]),
            vec![
                "第1章.md",
                "第2章.md",
                "第3章.md",
                "第11章.md",
                "第123章.md"
            ]
        );
    }

    #[test]
    fn natural_name_cmp_sorts_chinese_numbers_by_value() {
        assert_eq!(
            sorted_names(&[
                "第十章.md",
                "第一章.md",
                "第一二三章.md",
                "第三章.md",
                "第二章.md"
            ]),
            vec![
                "第一章.md",
                "第二章.md",
                "第三章.md",
                "第十章.md",
                "第一二三章.md"
            ]
        );
    }

    #[test]
    fn natural_name_cmp_sorts_unit_based_chinese_numbers_by_value() {
        assert_eq!(
            sorted_names(&[
                "第一百二十三章.md",
                "第十一章.md",
                "第二十章.md",
                "第九章.md"
            ]),
            vec![
                "第九章.md",
                "第十一章.md",
                "第二十章.md",
                "第一百二十三章.md"
            ]
        );
    }
}
