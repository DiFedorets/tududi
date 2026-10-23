const moment = require('moment-timezone');
const {
    getSafeTimezone,
    getUpcomingRangeInUTC,
} = require('../../../utils/timezone-utils');
function upcomingRange(params, timezone) {
    const zone = getSafeTimezone(timezone);
    const today = moment.tz(zone).startOf('day');
    const supplied =
        params.range_start !== undefined || params.range_end !== undefined;
    if (!supplied)
        return {
            ...getUpcomingRangeInUTC(zone, 7),
            startDay: today.format('YYYY-MM-DD'),
            endDay: today.clone().add(7, 'days').format('YYYY-MM-DD'),
            days: 8,
            explicit: false,
        };
    const parse = (value) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? moment.tz(value, 'YYYY-MM-DD', true, zone)
            : null;
    const a = parse(params.range_start),
        b = parse(params.range_end);
    if (
        !a?.isValid() ||
        !b?.isValid() ||
        a.year() < 1 ||
        b.year() < 1 ||
        b.isBefore(a) ||
        b.diff(a, 'days') > 34
    ) {
        const error = new Error(
            'Выберите корректный диапазон до 35 дней: начало не позже конца.'
        );
        error.status = 400;
        throw error;
    }
    return {
        start: a.clone().startOf('day').toDate(),
        end: b.clone().endOf('day').toDate(),
        startDay: a.format('YYYY-MM-DD'),
        endDay: b.format('YYYY-MM-DD'),
        days: b.diff(a, 'days') + 1,
        explicit: true,
    };
}
module.exports = { upcomingRange };
