import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';
const app =require( '../../index')

chai.use(chaiHttp);

/**
 * Check how we'll be doing this because the project setup isn't optimal
 * * Move everything to src to split testing and app
 * * 
 */

describe('Test basic app', () => {
  it('should answer to the health-check',async () => {
   await chai.request(app).get('/health-check')
    .end((err, res) => {
      expect(err).not.to.exist;
      expect(res.body).to.be.a('object')
      expect(res.status).to.eq(200)
      expect(res.body.timestamp).to.be.a('number')
    })
    .catch((err)=>{ throw err })
  })
});
