import HashtagsController from '../../../controllers/api/v2/HashtagsController';

export default function addRoutes(app) {
  app.get('/hashtags/sparseMatches', HashtagsController.sparseMatches);
}
