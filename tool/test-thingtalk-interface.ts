// import * as argparse from 'argparse';
// import * as tti from '../lib/utils/interface-to-thingtalk';
// import { serializePrediction } from '../lib/utils/thingtalk';
// import { EntityUtils } from '../lib';

// export function initArgparse(subparsers : argparse.SubParser) {
//     const parser = subparsers.add_parser('test-tti', {
//         add_help: true,
//         description: "Test TTI"
//     });
//     parser.add_argument('-d', '--device', {
//         required: false,
//         help: `...`
//     });
// }

// export async function execute() {
//     process.stdout.write("testing tti... ");
//     const q = new tti.ThingtalkComposer("com.yelp");
//     const program = await q.invoke("restaurant");
//     const entityDummy = EntityUtils.makeDummyEntities("");
//     const options = { locale: "", timezone: undefined, includeEntityValue: true };
//     const d = serializePrediction(program, "", entityDummy, options).join(' ');
//     console.log(d);
// }