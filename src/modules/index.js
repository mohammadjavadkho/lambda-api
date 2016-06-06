/**
 * Created by mohammadjavad on 5/28/2016.
 */
var sdk = require('backtory-sdk-js');

exports.handler = function(requestBody, context) {
    console.log(requestBody);

//     context.log("starting");
    sdk.storage.filterObjects("Home", {include: "RelatedBanner,RelatedCategory"}, {}, function(status, body, headers) {
//         context.log(body);
        var homeItems = body.results || [];
        var result = homeItems.map(function (homeItem){
            var item = {
                listIndex: homeItem.ListIndex
            };
            if(homeItem.RelatedCategory && homeItem.RelatedCategory._id){
                var category = homeItem.RelatedCategory;
                item.type = 3;
                item.title = category.Title;
                item.categoryId = category._id;
            }else if(homeItem.RelatedBanner){
                var banner = homeItem.RelatedBanner;
                var type, clickData;

                if (banner.RelatedCategory && banner.RelatedCategory != null) {
                    type = 1;
                    clickData = banner.RelatedCategory._id;
                }else{
                    type = 2;
                    clickData = banner.ClickUrl;
                }

                item.type = type;
                item.imageUrl = banner.ImageUrl;
                item.aspectRatio = banner.ImageAspectRatio;
                item.clickData = clickData;
            }

            return item;
        });
        result.sort(function (a, b){return a.listIndex > b.listIndex;});
        context.succeed(result);
    });
};
