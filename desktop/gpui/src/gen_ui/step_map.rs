//! ProseMirror's StepMap for nonnegative native document coordinates.
//! Adapted from prosemirror-transform 1.12.0 (MIT; see the fixture license).
//!
//! Ranges, inputs and mapped outputs must stay within JavaScript's safe integer
//! domain. Recovery tokens deliberately remain IEEE-754 numbers: using u64
//! would change Source's recovery behavior for large offsets or range indices.
use std::{fmt, sync::Arc};

const MAX_POSITION: usize = (1_u64 << 53) as usize - 1;
const FACTOR16: f64 = 65_536.;
const DEL_BEFORE: u32 = 1;
const DEL_AFTER: u32 = 2;
const DEL_ACROSS: u32 = 4;
const DEL_SIDE: u32 = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecoveryToken(f64);
impl RecoveryToken {
    pub fn value(self) -> f64 {
        self.0
    }
    fn index(self) -> usize {
        self.0.rem_euclid(FACTOR16) as usize
    }
    fn offset(self) -> f64 {
        (self.0 - self.index() as f64) / FACTOR16
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MapResult {
    pub pos: usize,
    pub del_info: u32,
    pub recover: Option<RecoveryToken>,
}
impl MapResult {
    pub fn deleted(&self) -> bool {
        self.del_info & DEL_SIDE != 0
    }
    pub fn deleted_before(&self) -> bool {
        self.del_info & (DEL_BEFORE | DEL_ACROSS) != 0
    }
    pub fn deleted_after(&self) -> bool {
        self.del_info & (DEL_AFTER | DEL_ACROSS) != 0
    }
    pub fn deleted_across(&self) -> bool {
        self.del_info & DEL_ACROSS != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidStepMap;
impl fmt::Display for InvalidStepMap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The document position map is outside its valid coordinate domain.")
    }
}
impl std::error::Error for InvalidStepMap {}

#[derive(Clone, Debug)]
pub struct StepMap {
    ranges: Arc<[[usize; 3]]>,
    inverted: bool,
}
impl StepMap {
    /// Valid document changes are sorted, nonoverlapping triples. Reject invalid
    /// native coordinates rather than wrapping them during signed arithmetic.
    pub fn new(ranges: Vec<[usize; 3]>) -> Result<Self, InvalidStepMap> {
        let mut previous_end = 0;
        let mut diff: i64 = 0;
        for &[start, old, new] in &ranges {
            if start < previous_end || [start, old, new].iter().any(|n| *n > MAX_POSITION) {
                return Err(InvalidStepMap);
            }
            let old_end = start as i64 + old as i64;
            let new_start = start as i64 + diff;
            position(old_end)?;
            position(new_start)?;
            position(new_start + new as i64)?;
            previous_end = old_end as usize;
            diff += new as i64 - old as i64;
        }
        Ok(Self {
            ranges: Arc::from(ranges),
            inverted: false,
        })
    }
    pub fn empty() -> Self {
        Self {
            ranges: Arc::from([]),
            inverted: false,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }
    pub fn invert(&self) -> Self {
        Self {
            ranges: self.ranges.clone(),
            inverted: !self.inverted && !self.is_empty(),
        }
    }
    pub fn offset(n: i64) -> Result<Self, InvalidStepMap> {
        let size = n.unsigned_abs();
        if size > MAX_POSITION as u64 {
            return Err(InvalidStepMap);
        }
        if n == 0 {
            Ok(Self::empty())
        } else {
            Self::new(vec![if n < 0 {
                [0, size as usize, 0]
            } else {
                [0, 0, size as usize]
            }])
        }
    }
    /// Source returns NaN when a rounded recovery token names no range. None
    /// preserves that failure without admitting an invalid native position.
    pub fn recover(&self, token: RecoveryToken) -> Option<usize> {
        let index = token.index();
        let range = self.ranges.get(index)?;
        let diff: i64 = if self.inverted {
            0
        } else {
            self.ranges[..index]
                .iter()
                .map(|r| r[2] as i64 - r[1] as i64)
                .sum()
        };
        let result = range[0] as f64 + diff as f64 + token.offset();
        (result.is_finite()
            && result >= 0.
            && result <= MAX_POSITION as f64
            && result.fract() == 0.)
            .then_some(result as usize)
    }
    pub fn map(&self, pos: usize, assoc: i32) -> Result<usize, InvalidStepMap> {
        self.map_result(pos, assoc).map(|r| r.pos)
    }
    pub fn map_result(&self, pos: usize, assoc: i32) -> Result<MapResult, InvalidStepMap> {
        if pos > MAX_POSITION {
            return Err(InvalidStepMap);
        }
        let pos = pos as i64;
        let (old_index, new_index) = self.indices();
        let mut diff: i64 = 0;
        for (index, range) in self.ranges.iter().enumerate() {
            let start = range[0] as i64 - if self.inverted { diff } else { 0 };
            if start > pos {
                break;
            }
            let old = range[old_index] as i64;
            let new = range[new_index] as i64;
            let end = start + old;
            if pos <= end {
                let side = if old == 0 {
                    assoc
                } else if pos == start {
                    -1
                } else if pos == end {
                    1
                } else {
                    assoc
                };
                let mapped = position(start + diff + if side < 0 { 0 } else { new })?;
                let recover = (pos != if assoc < 0 { start } else { end })
                    .then(|| RecoveryToken(index as f64 + (pos - start) as f64 * FACTOR16));
                let mut del = if pos == start {
                    DEL_AFTER
                } else if pos == end {
                    DEL_BEFORE
                } else {
                    DEL_ACROSS
                };
                if if assoc < 0 { pos != start } else { pos != end } {
                    del |= DEL_SIDE;
                }
                return Ok(MapResult {
                    pos: mapped,
                    del_info: del,
                    recover,
                });
            }
            diff += new - old;
        }
        Ok(MapResult {
            pos: position(pos + diff)?,
            del_info: 0,
            recover: None,
        })
    }
    pub fn touches(&self, pos: usize, token: RecoveryToken) -> bool {
        if pos > MAX_POSITION {
            return false;
        }
        let pos = pos as i64;
        let (old_index, new_index) = self.indices();
        let mut diff: i64 = 0;
        for (index, range) in self.ranges.iter().enumerate() {
            let start = range[0] as i64 - if self.inverted { diff } else { 0 };
            if start > pos {
                break;
            }
            let old = range[old_index] as i64;
            if pos <= start + old && index == token.index() {
                return true;
            }
            diff += range[new_index] as i64 - old;
        }
        false
    }
    pub fn changed_ranges(&self) -> Vec<[usize; 4]> {
        let (old_index, new_index) = self.indices();
        let mut diff: i64 = 0;
        self.ranges
            .iter()
            .map(|range| {
                let start = range[0] as i64;
                let old_start = start - if self.inverted { diff } else { 0 };
                let new_start = start + if self.inverted { 0 } else { diff };
                let old = range[old_index] as i64;
                let new = range[new_index] as i64;
                diff += new - old;
                [
                    old_start as usize,
                    (old_start + old) as usize,
                    new_start as usize,
                    (new_start + new) as usize,
                ]
            })
            .collect()
    }
    fn indices(&self) -> (usize, usize) {
        if self.inverted { (2, 1) } else { (1, 2) }
    }
}
fn position(value: i64) -> Result<usize, InvalidStepMap> {
    if value < 0 || value > MAX_POSITION as i64 {
        Err(InvalidStepMap)
    } else {
        Ok(value as usize)
    }
}
