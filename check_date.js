const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const sample = await prisma.$queryRaw`SELECT B_DATE FROM t_balju WHERE B_DATE IS NOT NULL LIMIT 1`;
    console.log('Sample B_DATE:', sample);
    process.exit(0);
}
main();
