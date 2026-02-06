
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyDetailedLogic() {
    try {
        const date = '2026-02-06';
        const targetGroup = '콩나물';
        const targetDriver = '하(바른)';

        console.log(`=== [서버 쿼리 실측] 날짜: ${date}, 기사: ${targetDriver}, 분류: ${targetGroup} ===`);

        // 현재 api/index.js에 박혀있는 쿼리 구조 그대로 실행합니다.
        const query = `
            SELECT 
                group_name,
                driver_name,
                COUNT(*) as pick_count
            FROM (
                SELECT 
                    COALESCE(c340.CD_GROUP, p.P_DIV_PICK) as group_name,
                    b.CB_DRIVER as driver_name,
                    b.B_P_NO
                FROM t_balju b
                LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
                LEFT JOIN t_code_340 c340 ON p.P_DIV_PICK = c340.P_DIV_PICK
                WHERE b.B_DATE = '${date}'
                GROUP BY group_name, b.B_DATE, b.CB_DRIVER, b.B_P_NO
            ) as sub
            WHERE CONVERT(CAST(group_name AS BINARY) USING euckr) = '${targetGroup}'
            AND CONVERT(CAST(driver_name AS BINARY) USING euckr) = '${targetDriver}'
            GROUP BY group_name, driver_name
        `;

        const result = await prisma.$queryRawUnsafe(query);

        if (result.length === 0) {
            console.log("매칭되는 데이터를 찾지 못했습니다. (조건 확인 필요)");
        } else {
            console.log(`[쿼리 결과]`);
            console.log(`- 기사명: ${fixEncoding(result[0].driver_name)}`);
            console.log(`- 피킹 건수: ${Number(result[0].pick_count)} 건`);
        }

        // 만약 여전히 59라면, 기사명의 다른 공백이나 특수문자가 있는지 원본 바이너리를 확인합니다.
        const rawCheck = await prisma.$queryRaw`
            SELECT DISTINCT b.B_P_NO
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            WHERE b.B_DATE = ${date}
            AND CONVERT(CAST(b.CB_DRIVER AS BINARY) USING euckr) = ${targetDriver}
            AND CONVERT(CAST(p.P_DIV_PICK AS BINARY) USING euckr) = ${targetGroup}
        `;
        console.log(`\n- [검증] 해당 기사의 콩나물 품목 번호(B_P_NO)의 순수 종류 수: ${rawCheck.length} 종`);

    } catch (e) {
        console.error("쿼리 실행 중 에러:", e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyDetailedLogic();
