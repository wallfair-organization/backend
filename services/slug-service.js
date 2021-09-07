const generateSlug = require('../util/generateSlug');

exports.getSlug = async (input, EntityModel) => {
  const slug = generateSlug(input);
  const slugCounter = await EntityModel.countDocuments({
    slug
  });

  if (slugCounter === 0) {
    return slug;
  }
  
  return `${slug}-${slugCounter + 1}`;
}